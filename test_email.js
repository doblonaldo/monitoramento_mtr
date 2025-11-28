require('dotenv').config();
const nodemailer = require('nodemailer');

async function testEmail() {
    console.log('--- Email Debug Start ---');
    console.log('Host:', process.env.SMTP_HOST);
    console.log('Port:', process.env.SMTP_PORT);
    console.log('User:', process.env.SMTP_USER);
    console.log('Secure:', process.env.SMTP_SECURE);
    console.log('Pass Length:', process.env.SMTP_PASS ? process.env.SMTP_PASS.length : 0);

    const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: process.env.SMTP_PORT,
        secure: process.env.SMTP_SECURE === 'true' || process.env.SMTP_PORT == 465,
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS
        },
        tls: {
            rejectUnauthorized: false,
            debug: true
        },
        debug: true,
        logger: true
    });

    try {
        console.log('Attempting to verify connection...');
        await transporter.verify();
        console.log('Connection Verified Successfully!');

        console.log('Attempting to send mail...');
        const info = await transporter.sendMail({
            from: `"Test" <${process.env.SMTP_USER}>`,
            to: process.env.SMTP_USER,
            subject: 'Test Email - Debug',
            text: 'If you receive this, the configuration is correct.'
        });
        console.log('Email sent successfully:', info.messageId);
    } catch (error) {
        console.error('--- ERROR DETAILS ---');
        console.error('Code:', error.code);
        console.error('Command:', error.command);
        console.error('Response:', error.response);
        console.error('Message:', error.message);
        console.error('Stack:', error.stack);
    }
    console.log('--- Email Debug End ---');
}

testEmail();
