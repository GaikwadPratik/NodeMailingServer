import * as NodeMailer from 'nodemailer';
import * as SmtpTransport from 'nodemailer-smtp-transport';
import * as Crypto from 'crypto';
import * as net from 'net';
import * as fs from 'fs';
import * as path from 'path';
import * as express from 'express';
import * as bodyParser from 'body-parser';
import * as http from 'http';
import * as io from 'socket.io';

class MailServer {

    constructor() {
        this.Config();
    }

    private _port = process.env.port || 61337;

    //File name where configuration is stored
    private _fileName: string = 'mail.config.json';

    //mail id in the "from" of the mail
    private _fromMail: string = '';

    //Autherization option for mail sending
    private _smtpAuthOptions: SmtpTransport.AuthOptions = {};

    //options for mail sending
    private _smtpOptions: SmtpTransport.SmtpOptions = {};

    //Algorithm used for encryption and decryption
    private _algorithmForCrypto: string = '';

    //Phrasefor encryption and decryption
    private _cryptPassword: string = '';

    private _smtpTransport: NodeMailer.Transport = null;

    private _mailSendTransporter: NodeMailer.Transporter = null;

    private _express: express.Application = null;

    public LoadMailServer() {

        let _httpServer: http.Server = http.createServer(this._express);
        let _ioServer: SocketIO.Server = io(_httpServer);

        _ioServer.on('connection', (socket: SocketIO.Socket) => {
            console.log(`${new Date()} Server:mail request received`);

            socket.on('disconnect', () => {
                console.log(`${new Date()} Server:mail request finished`);
            });

            // Handle data from client
            socket.on("request", (data) => {

                let _data = JSON.parse(data.toString());

                //send mail and respond back
                this.SendMail(_data.ToEmails, _data.Subject, _data.Body)
                    .then(() => {
                        socket.emit('response', JSON.stringify({ response: "MAILSENT" }));
                    })
                    .catch((err) => {
                        socket.emit('response', JSON.stringify({ response: "FAILURE" }));
                    });
            });
        });

        _httpServer.listen(this._port, () => {
            console.log(`${new Date()} Listening on ${this._port}`);
        });
    }

    private Config() {
        this._express = express();

        //body parser
        this._express.use(bodyParser.json());
        this._express.use(bodyParser.urlencoded({ extended: false }));
    }

    private LoadAuthenticationConfig() {
        //Read from file.
        let _filePath = path.join(__dirname, this._fileName);
        return new Promise((resolve, reject) => {
            fs.readFile(_filePath, 'utf8', (err: NodeJS.ErrnoException, data: string) => {
                if (err) {
                    //if the error is specifically file not found
                    if (err.code === 'ENOENT')
                        console.log(`The file with name '${this._fileName}' is not found in directory '${__dirname}'. Please check if config file is present.`);
                    else
                        console.log(err);
                    //in case of error reject the promise
                    reject(false);
                }
                else {
                    data = data.replace(/^\uFEFF/, '');
                    //Convert json data into configuration object and return
                    let _config = JSON.parse(data);

                    this._algorithmForCrypto = _config.AuthConfig.CryptoAlgorithm;
                    this._cryptPassword = _config.AuthConfig.CryptoPassword;

                    this._smtpAuthOptions = {
                        user: this.Decrypt(_config.AuthConfig.username),
                        pass: this.Decrypt(_config.AuthConfig.password)
                    };
                    this._smtpOptions = {
                        host: this.Decrypt(_config.MailConfig.host),
                        port: _config.MailConfig.port,
                        auth: this._smtpAuthOptions
                    }
                    this._fromMail = this.Decrypt(_config.MailConfig.fromMail);

                    resolve(true);
                }
            });
        });
    }

    private Encrypt(text: string) {
        let _cipher: Crypto.Cipher = Crypto.createCipher(this._algorithmForCrypto, this._cryptPassword);
        let _cryptedText: string = _cipher.update(text.trim(), 'utf8', 'hex');
        _cryptedText += _cipher.final('hex');
        return _cryptedText;
    }

    private Decrypt(text: string) {
        let _decipher: Crypto.Decipher = Crypto.createDecipher(this._algorithmForCrypto, this._cryptPassword);
        let _decrypted: string = _decipher.update(text.trim(), 'hex', 'utf8');
        _decrypted += _decipher.final('utf8');
        return _decrypted;
    }

    private SendMail(toEmails: string[] | string, subject: string, body: string): Promise<{}> {
        return new Promise((resolve, reject) => {
            try {
                this.LoadAuthenticationConfig()
                    .then(() => {
                        this._smtpTransport = SmtpTransport(this._smtpOptions);

                        this._mailSendTransporter = NodeMailer.createTransport(this._smtpTransport);

                        this._mailSendTransporter
                            .verify()
                            .catch((err) => {
                                console.log(err);
                                if (this._mailSendTransporter)
                                    this._mailSendTransporter.close();
                                reject(false);
                            });

                        let _mailOptions: NodeMailer.SendMailOptions = {
                            from: this._fromMail,
                            to: toEmails,
                            subject: subject,
                            text: body
                        }

                        //Send mail
                        this._mailSendTransporter.sendMail(_mailOptions)
                            .then(() => {//Once mail sent is successful
                                resolve(true);
                            })
                            .catch((err) => {//in case of any error.
                                console.log(err);
                                if (this._mailSendTransporter)
                                    this._mailSendTransporter.close();
                                reject(false);
                            });

                        //Close connection once mail sending is done
                        if (this._mailSendTransporter)
                            this._mailSendTransporter.close();
                    })
                    .catch((err) => {
                        console.log(err);
                        if (this._mailSendTransporter)
                            this._mailSendTransporter.close();
                        reject(false);
                    });
            }
            catch (exception) {
                console.log(exception);
                if (this._mailSendTransporter)
                    this._mailSendTransporter.close();
                reject(false);
            }
        });
    }
}


let _mailServer = new MailServer();
_mailServer.LoadMailServer();