import { existsSync } from 'node:fs';
const local = existsSync(new URL('./config.local.js', import.meta.url)) ? (await import('./config.local.js')).default : {};
export default {
 host: '0.0.0.0', port: 3014, siteName: 'SolarisBugs', publicUrl: 'https://bugs.example.com',
 sessionSecret: 'CHANGE-ME', setupKey: 'CHANGE-ME',
 trustProxy: 1, secureCookies: true, allowRegistration: true, uploadLimitMB: 10,
 mysql: { host: '127.0.0.1', port: 3306, user: 'solarisbugs', password: '', database: 'solarisbugs' },
 ...local
};
