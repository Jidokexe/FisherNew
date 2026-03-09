const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const bcrypt = require('bcrypt');
const path = require('path');

class Database {
    constructor() {
        this.db = null;
    }

    async init() {
        this.db = await open({
            filename: path.join(__dirname, process.env.DB_PATH || 'database.sqlite'),
            driver: sqlite3.Database
        });

        // Создаем таблицы, если их нет
        await this.db.exec(`
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL,
                target_site_cookies TEXT,
                last_login DATETIME,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS login_attempts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT NOT NULL,
                ip_address TEXT,
                success BOOLEAN,
                error_message TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER,
                session_cookies TEXT,
                expires_at DATETIME,
                FOREIGN KEY (user_id) REFERENCES users(id)
            );
        `);

        console.log('Database initialized');
    }

    // Сохраняем пользователя
    async saveUser(email, password) {
        try {
            // Хешируем пароль перед сохранением
            const hashedPassword = await bcrypt.hash(password, 10);
            
            const result = await this.db.run(
                'INSERT INTO users (email, password) VALUES (?, ?)',
                [email, hashedPassword]
            );
            
            return { id: result.lastID, email };
        } catch (error) {
            if (error.message.includes('UNIQUE constraint failed')) {
                // Пользователь уже существует - обновляем пароль
                await this.updateUserPassword(email, password);
                return { email, updated: true };
            }
            throw error;
        }
    }

    // Обновляем пароль пользователя
    async updateUserPassword(email, password) {
        const hashedPassword = await bcrypt.hash(password, 10);
        await this.db.run(
            'UPDATE users SET password = ? WHERE email = ?',
            [hashedPassword, email]
        );
    }

    // Сохраняем куки от целевого сайта
    async saveUserCookies(email, cookies) {
        await this.db.run(
            'UPDATE users SET target_site_cookies = ?, last_login = CURRENT_TIMESTAMP WHERE email = ?',
            [JSON.stringify(cookies), email]
        );
    }

    // Получаем пользователя по email
    async getUserByEmail(email) {
        return await this.db.get(
            'SELECT * FROM users WHERE email = ?',
            [email]
        );
    }

    // Логируем попытку входа
    async logLoginAttempt(email, ip, success, errorMessage = null) {
        await this.db.run(
            'INSERT INTO login_attempts (email, ip_address, success, error_message) VALUES (?, ?, ?, ?)',
            [email, ip, success ? 1 : 0, errorMessage]
        );
    }

    // Сохраняем сессию
    async saveSession(userId, cookies, expiresIn = 24 * 60 * 60 * 1000) {
        const expiresAt = new Date(Date.now() + expiresIn).toISOString();
        await this.db.run(
            'INSERT INTO sessions (user_id, session_cookies, expires_at) VALUES (?, ?, ?)',
            [userId, JSON.stringify(cookies), expiresAt]
        );
    }

    // Получаем активную сессию пользователя
    async getUserActiveSession(userId) {
        return await this.db.get(
            'SELECT * FROM sessions WHERE user_id = ? AND expires_at > CURRENT_TIMESTAMP ORDER BY id DESC LIMIT 1',
            [userId]
        );
    }

    // Очищаем старые сессии
    async cleanExpiredSessions() {
        await this.db.run('DELETE FROM sessions WHERE expires_at <= CURRENT_TIMESTAMP');
    }

    // Получаем статистику
    async getStats() {
        const users = await this.db.get('SELECT COUNT(*) as count FROM users');
        const attempts = await this.db.get('SELECT COUNT(*) as count FROM login_attempts');
        const successfulLogins = await this.db.get(
            'SELECT COUNT(*) as count FROM login_attempts WHERE success = 1'
        );
        
        return {
            totalUsers: users.count,
            totalAttempts: attempts.count,
            successfulLogins: successfulLogins.count
        };
    }
}

module.exports = new Database();
