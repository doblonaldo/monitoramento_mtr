const fs = require('fs');
try {
    const content = fs.readFileSync('server.log', 'utf8');
    const lines = content.split('\n');
    const errors = lines.filter(l => l.toLowerCase().includes('error') || l.toLowerCase().includes('fail') || l.includes('Exception'));
    console.log('--- Last 20 Errors ---');
    console.log(errors.slice(-20).join('\n'));
} catch (e) {
    console.log('Error reading log:', e.message);
}
