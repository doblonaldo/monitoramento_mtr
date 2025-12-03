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

    // 5. Test Role Change Invalidation
    console.log('5. Testing Role Change Invalidation...');

    // 5a. Create test_editor
    console.log('   Creating test_editor...');
    // We need to use a direct DB call or invite flow. Invite flow is complex for script (needs to parse link).
    // Let's use the invite endpoint but we can't easily set password without parsing the token.
    // Actually, for this test, let's just use the admin to create a user directly if possible? 
    // The API only has invite. 
    // Workaround: Use the invite link token to set password.

    const inviteEditorRes = await request('POST', '/api/users/invite', { email: 'test_editor', role: 'editor' }, ADMIN_TOKEN);
    let setupToken = '';
    if (inviteEditorRes.status === 201) {
        const link = inviteEditorRes.body.link;
        setupToken = link.split('token=')[1];
    } else if (inviteEditorRes.status === 409) {
        // User exists, we need to reset password to get a token? Or just delete and recreate.
        await request('DELETE', '/api/users/test_editor', null, ADMIN_TOKEN);
        const retryInvite = await request('POST', '/api/users/invite', { email: 'test_editor', role: 'editor' }, ADMIN_TOKEN);
        setupToken = retryInvite.body.link.split('token=')[1];
    }

    // 5b. Set password
    await request('POST', '/api/auth/setup-password', { token: setupToken, password: 'password123' });

    // 5c. Login as test_editor
    const loginEditorRes = await request('POST', '/api/login', { username: 'test_editor', password: 'password123' });
    const EDITOR_TOKEN = loginEditorRes.body.accessToken;
    console.log('   Logged in as test_editor.');

    // 5d. Verify Editor Access (Add Host)
    const addHostRes = await request('POST', '/api/hosts', { destino: '8.8.4.4', title: 'Google DNS 2' }, EDITOR_TOKEN);
    if (addHostRes.status !== 201 && addHostRes.status !== 409) {
        console.error('   Failed to add host as editor:', addHostRes.status);
    } else {
        console.log('   Editor access confirmed.');
    }

    // 5e. Change Role to Viewer
    console.log('   Changing role to viewer...');
    await request('PUT', '/api/users/test_editor', { role: 'viewer' }, ADMIN_TOKEN);

    // 5f. Try Editor Action again (Add Host) - Should Fail
    console.log('   Retrying editor action...');
    const retryAddHostRes = await request('POST', '/api/hosts', { destino: '1.0.0.1', title: 'Cloudflare DNS 2' }, EDITOR_TOKEN);

    if (retryAddHostRes.status === 403) {
        console.log('   Success! Token invalidated (403 Forbidden).');
    } else {
        console.error(`   Failure! Expected 403, got ${retryAddHostRes.status}`);
    }

    // Cleanup
    await request('DELETE', '/api/users/test_editor', null, ADMIN_TOKEN);
    await request('DELETE', '/api/hosts/8.8.4.4', null, ADMIN_TOKEN); // Clean up host if added

    console.log('--- Verification Complete ---');
}

runTests().catch(console.error);
