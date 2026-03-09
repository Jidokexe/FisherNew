const puppeteer = require('puppeteer');

class PuppeteerAuth {
    async login(email, password) {
        let browser = null;
        
        try {
            console.log(`Starting Puppeteer for login: ${email}`);
            
            // Запускаем браузер с оптимальными настройками для сервера
            browser = await puppeteer.launch({
                headless: true, // true для продакшена
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas',
                    '--disable-gpu',
                    '--window-size=1920,1080'
                ],
                defaultViewport: {
                    width: 1920,
                    height: 1080
                }
            });

            const page = await browser.newPage();
            
            // Устанавливаем User-Agent как у реального браузера
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
            
            // Включаем логирование для отладки
            page.on('console', msg => console.log('Browser console:', msg.text()));
            
            // Переходим на страницу входа
            console.log('Navigating to login page...');
            await page.goto('https://newlxp.ru/sign-in', {
                waitUntil: 'networkidle0',
                timeout: 30000
            });

            // Ждем появления формы
            await page.waitForSelector('input[type="email"], input[name="email"]', {
                timeout: 10000
            });

            // Заполняем форму (пробуем разные селекторы)
            console.log('Filling login form...');
            
            // Поиск поля email по разным селекторам
            const emailInput = await page.$('input[type="email"], input[name="email"], input#email, input[placeholder*="Email"]');
            if (emailInput) {
                await emailInput.type(email, { delay: 50 });
            } else {
                throw new Error('Email field not found');
            }

            // Поиск поля пароля
            const passwordInput = await page.$('input[type="password"], input[name="password"], input#password');
            if (passwordInput) {
                await passwordInput.type(password, { delay: 50 });
            } else {
                throw new Error('Password field not found');
            }

            // Поиск кнопки отправки
            const submitButton = await page.$('button[type="submit"], button:has-text("Войти"), input[type="submit"]');
            
            if (!submitButton) {
                throw new Error('Submit button not found');
            }

            // Отправляем форму и ждем навигации
            console.log('Submitting form...');
            
            await Promise.all([
                page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 15000 }),
                submitButton.click()
            ]);

            // Проверяем успешность входа
            const currentUrl = page.url();
            const pageContent = await page.content();
            
            // Ищем признаки успешного входа
            const loginSuccess = !currentUrl.includes('/sign-in') && 
                                !pageContent.includes('неверный') && 
                                !pageContent.includes('ошибка');

            if (!loginSuccess) {
                // Проверяем наличие сообщения об ошибке
                const errorElement = await page.$('.error-message, .alert, [class*="error"]');
                const errorText = errorElement ? await page.evaluate(el => el.textContent, errorElement) : 'Unknown error';
                
                throw new Error(`Login failed: ${errorText}`);
            }

            // Получаем куки
            const cookies = await page.cookies();
            
            // Получаем HTML защищенной страницы (опционально)
            const protectedContent = await page.content();

            console.log('Login successful!');
            
            return {
                success: true,
                cookies,
                currentUrl,
                protectedContent: protectedContent.substring(0, 500) // Первые 500 символов для проверки
            };

        } catch (error) {
            console.error('Puppeteer error:', error);
            return {
                success: false,
                error: error.message
            };
        } finally {
            if (browser) {
                await browser.close();
                console.log('Browser closed');
            }
        }
    }

    // Метод для проверки сессии через куки
    async checkSessionWithCookies(cookies) {
        let browser = null;
        
        try {
            browser = await puppeteer.launch({
                headless: true,
                args: ['--no-sandbox']
            });

            const page = await browser.newPage();
            
            // Устанавливаем сохраненные куки
            if (cookies && cookies.length > 0) {
                await page.setCookie(...cookies);
            }

            // Пытаемся зайти на защищенную страницу
            await page.goto('https://newlxp.ru/dashboard', {
                waitUntil: 'networkidle0',
                timeout: 10000
            });

            // Проверяем, не редиректнуло ли на страницу входа
            const currentUrl = page.url();
            const isValid = !currentUrl.includes('/sign-in');

            return {
                isValid,
                currentUrl
            };

        } catch (error) {
            console.error('Session check error:', error);
            return {
                isValid: false,
                error: error.message
            };
        } finally {
            if (browser) {
                await browser.close();
            }
        }
    }
}

module.exports = new PuppeteerAuth();
