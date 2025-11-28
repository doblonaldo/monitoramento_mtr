const fs = require('fs');
const bcrypt = require('bcrypt');

async function test() {
    console.log('Testing bcrypt...');
    try {
        const hash = await bcrypt.hash('test', 10);
        console.log('Hash created:', hash);
        const match = await bcrypt.compare('test', hash);
        console.log('Match:', match);
    } catch (e) {
        console.error('Bcrypt error:', e);
    }

    console.log('Reading db.json...');
    try {
        const data = fs.readFileSync('db.json', 'utf-8');
        const db = JSON.parse(data);
        console.log('DB loaded. Users:', db.users);

        if (!db.users || db.users.length === 0) {
            console.log('Creating admin...');
            const hashedPassword = await bcrypt.hash('admin123', 10);
            db.users = [{ username: 'admin', passwordHash: hashedPassword, role: 'admin' }];
            fs.writeFileSync('db.json', JSON.stringify(db, null, 2));
            console.log('Admin created and saved.');
        }
    } catch (e) {
        console.error('DB error:', e);
    }
}

test();
