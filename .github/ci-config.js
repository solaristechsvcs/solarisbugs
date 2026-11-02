export default {
 port: 3014, host: '127.0.0.1', publicUrl: 'http://127.0.0.1:3014',
 secureCookies: false, trustProxy: false,
 sessionSecret: 'ci-only-session-secret-not-for-production-12345',
 setupKey: 'ci-only-setup-secret-not-for-production-1234567',
 mysql: { host: '127.0.0.1', port: 3306, user: 'root', password: 'ci-password', database: 'solarisbugs' }
};
