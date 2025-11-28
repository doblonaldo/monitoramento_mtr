require('dotenv').config();
const nodemailer = require('nodemailer');

async function testEmail() {
    console.log('Testing email...');
    console.log('Host:', process.env.SMTP_HOST);
    console.log('Port:', process.env.SMTP_PORT);
    console.log('User:', process.env.SMTP_USER);

    const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: process.env.SMTP_PORT,
        secure: false,
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS
        }
    });

    try {
        const info = await transporter.sendMail({
            from: '"Test" <test@example.com>',
            to: process.env.SMTP_USER, // Send to self
            subject: 'Test Email',
            text: 'This is a test email.'
        });
        console.log('Email sent:', info.messageId);
    } catch (error) {
        console.error('Error sending email:', error);
    }
}

testEmail();
