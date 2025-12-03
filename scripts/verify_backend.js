const http = require('http');

const BASE_URL = 'http://localhost:3000';
let ADMIN_TOKEN = '';

async function request(method, path, body = null, token = null) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'localhost',
            port: 3000,
            path: path,
            method: method,
            headers: {
                'Content-Type': 'application/json',
            }
        };

        if (token) {
            options.headers['Authorization'] = `Bearer ${token}`;
        }

        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    resolve({ status: res.statusCode, body: json });
                } catch (e) {
                    resolve({ status: res.statusCode, body: data });
                }
            });
        });

        req.on('error', (e) => reject(e));

        if (body) {
            req.write(JSON.stringify(body));
        }
        req.end();
    });
}

async function runTests() {
    console.log('--- Starting Verification ---');

    // 1. Login as Admin
    console.log('1. Logging in as admin...');
    const loginRes = await request('POST', '/api/login', { username: 'admin', password: 'admin123' });
    if (loginRes.status !== 200) {
        console.error('Failed to login:', loginRes.body);
        process.exit(1);
    }
    ADMIN_TOKEN = loginRes.body.accessToken;
    console.log('   Success. Token obtained.');

    // 2. List Users
    console.log('2. Listing users...');
    const usersRes = await request('GET', '/api/users', null, ADMIN_TOKEN);
    if (usersRes.status !== 200 || !Array.isArray(usersRes.body)) {
        console.error('Failed to list users:', usersRes.body);
    } else {
        console.log(`   Success. Found ${usersRes.body.length} users.`);
    }

    // 3. Invite User
    console.log('3. Inviting user test_invite...');
    const inviteRes = await request('POST', '/api/users/invite', { email: 'test_invite', role: 'viewer' }, ADMIN_TOKEN);
    if (inviteRes.status !== 201) {
        if (inviteRes.status === 409) {
            console.log('   User already exists (expected if re-running).');
        } else {
            console.error('Failed to invite user:', inviteRes.body);
        }
    } else {
        console.log('   Success. Invite link:', inviteRes.body.link);
    }

    // 4. Get Logs
    console.log('4. Getting system logs...');
    const logsRes = await request('GET', '/api/logs', null, ADMIN_TOKEN);
    if (logsRes.status !== 200 || !Array.isArray(logsRes.body)) {
        console.error('Failed to get logs:', logsRes.body);
    } else {
        console.log(`   Success. Found ${logsRes.body.length} logs.`);
    }

    console.log('--- Verification Complete ---');
}

runTests().catch(console.error);
