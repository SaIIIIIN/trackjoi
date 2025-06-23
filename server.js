const express = require('express');
const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Конфигурация базы данных
const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'trackjoi',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
};

const pool = mysql.createPool(dbConfig);

// JWT секретный ключ
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

// Middleware для аутентификации
const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Токен доступа отсутствует' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(403).json({ error: 'Недействительный токен' });
  }
};

// МАРШРУТЫ АУТЕНТИФИКАЦИИ

// Регистрация
app.post('/api/register', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email и пароль обязательны' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Пароль должен содержать минимум 6 символов' });
    }

    // Проверяем, существует ли пользователь
    const [existingUsers] = await pool.execute(
      'SELECT id FROM users WHERE email = ?',
      [email]
    );

    if (existingUsers.length > 0) {
      return res.status(400).json({ error: 'Пользователь с таким email уже существует' });
    }

    // Хешируем пароль
    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    // Создаем пользователя
    const [result] = await pool.execute(
      'INSERT INTO users (email, password_hash) VALUES (?, ?)',
      [email, passwordHash]
    );

    const userId = result.insertId;

    // Создаем JWT токен
    const token = jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: '30d' });

    res.status(201).json({
      success: true,
      message: 'Пользователь успешно зарегистрирован',
      token,
      user: { id: userId, email }
    });

  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Ошибка сервера при регистрации' });
  }
});

// Вход
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email и пароль обязательны' });
    }

    // Находим пользователя
    const [users] = await pool.execute(
      'SELECT id, email, password_hash FROM users WHERE email = ? AND is_active = TRUE',
      [email]
    );

    if (users.length === 0) {
      return res.status(401).json({ error: 'Неверный email или пароль' });
    }

    const user = users[0];

    // Проверяем пароль
    const isValidPassword = await bcrypt.compare(password, user.password_hash);

    if (!isValidPassword) {
      return res.status(401).json({ error: 'Неверный email или пароль' });
    }

    // Обновляем время последнего входа
    await pool.execute(
      'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?',
      [user.id]
    );

    // Создаем JWT токен
    const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: '30d' });

    res.json({
      success: true,
      message: 'Успешный вход',
      token,
      user: { id: user.id, email: user.email }
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Ошибка сервера при входе' });
  }
});

// МАРШРУТЫ ДЛЯ АКТИВНОСТЕЙ

// Получить все активности пользователя
app.get('/api/activities', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;

    const [activities] = await pool.execute(`
      SELECT 
        a.id,
        a.name,
        a.description,
        a.reminder,
        a.created_at,
        GROUP_CONCAT(ad.day_of_week ORDER BY 
          CASE ad.day_of_week 
            WHEN 'пн' THEN 1 WHEN 'вт' THEN 2 WHEN 'ср' THEN 3 WHEN 'чт' THEN 4 
            WHEN 'пт' THEN 5 WHEN 'сб' THEN 6 WHEN 'нд' THEN 7 
          END
        ) as days,
        COUNT(DISTINCT CASE 
          WHEN al.completed_date >= DATE_SUB(CURDATE(), INTERVAL WEEKDAY(CURDATE()) DAY)
          AND al.completed_date <= DATE_ADD(DATE_SUB(CURDATE(), INTERVAL WEEKDAY(CURDATE()) DAY), INTERVAL 6 DAY)
          AND al.status = 'completed'
          THEN al.id 
        END) as completed_this_week
      FROM activities a
      LEFT JOIN activity_days ad ON a.id = ad.activity_id
      LEFT JOIN activity_logs al ON a.id = al.activity_id
      WHERE a.user_id = ? AND a.is_active = TRUE
      GROUP BY a.id, a.name, a.description, a.reminder, a.created_at
      ORDER BY a.created_at DESC
    `, [userId]);

    // Преобразуем дни в массив
    const formattedActivities = activities.map(activity => ({
      ...activity,
      days: activity.days ? activity.days.split(',') : [],
      completedThisWeek: activity.completed_this_week || 0
    }));

    res.json({ success: true, activities: formattedActivities });

  } catch (error) {
    console.error('Get activities error:', error);
    res.status(500).json({ error: 'Ошибка при получении активностей' });
  }
});

// Создать новую активность
app.post('/api/activities', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { name, description, reminder, days } = req.body;

    if (!name || !Array.isArray(days) || days.length === 0) {
      return res.status(400).json({ error: 'Название и дни недели обязательны' });
    }

    const connection = await pool.getConnection();
    await connection.beginTransaction();

    try {
      // Создаем активность
      const [result] = await connection.execute(
        'INSERT INTO activities (user_id, name, description, reminder) VALUES (?, ?, ?, ?)',
        [userId, name, description || null, reminder || false]
      );

      const activityId = result.insertId;

      // Добавляем дни недели
      const dayValues = days.map(day => [activityId, day]);
      for (const [actId, day] of dayValues) {
        await connection.execute(
          'INSERT INTO activity_days (activity_id, day_of_week) VALUES (?, ?)',
          [actId, day]
        );
      }

      await connection.commit();

      res.status(201).json({
        success: true,
        message: 'Активность создана успешно',
        activity: { id: activityId, name, description, reminder, days }
      });

    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }

  } catch (error) {
    console.error('Create activity error:', error);
    res.status(500).json({ error: 'Ошибка при создании активности' });
  }
});

// Обновить активность
app.put('/api/activities/:id', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const activityId = req.params.id;
    const { name, description, reminder, days } = req.body;

    if (!name || !Array.isArray(days) || days.length === 0) {
      return res.status(400).json({ error: 'Название и дни недели обязательны' });
    }

    const connection = await pool.getConnection();
    await connection.beginTransaction();

    try {
      // Проверяем, принадлежит ли активность пользователю
      const [activities] = await connection.execute(
        'SELECT id FROM activities WHERE id = ? AND user_id = ?',
        [activityId, userId]
      );

      if (activities.length === 0) {
        return res.status(404).json({ error: 'Активность не найдена' });
      }

      // Обновляем активность
      await connection.execute(
        'UPDATE activities SET name = ?, description = ?, reminder = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [name, description || null, reminder || false, activityId]
      );

      // Удаляем старые дни
      await connection.execute(
        'DELETE FROM activity_days WHERE activity_id = ?',
        [activityId]
      );

      // Добавляем новые дни
      for (const day of days) {
        await connection.execute(
          'INSERT INTO activity_days (activity_id, day_of_week) VALUES (?, ?)',
          [activityId, day]
        );
      }

      await connection.commit();

      res.json({
        success: true,
        message: 'Активность обновлена успешно',
        activity: { id: activityId, name, description, reminder, days }
      });

    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }

  } catch (error) {
    console.error('Update activity error:', error);
    res.status(500).json({ error: 'Ошибка при обновлении активности' });
  }
});

// Удалить активность
app.delete('/api/activities/:id', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const activityId = req.params.id;

    const [result] = await pool.execute(
      'UPDATE activities SET is_active = FALSE WHERE id = ? AND user_id = ?',
      [activityId, userId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Активность не найдена' });
    }

    res.json({ success: true, message: 'Активность удалена успешно' });

  } catch (error) {
    console.error('Delete activity error:', error);
    res.status(500).json({ error: 'Ошибка при удалении активности' });
  }
});

// Отметить выполнение активности
app.post('/api/activities/:id/complete', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const activityId = req.params.id;
    const { date, status, notes } = req.body;

    const completedDate = date || new Date().toISOString().split('T')[0];
    const activityStatus = status || 'completed';

    // Проверяем, принадлежит ли активность пользователю
    const [activities] = await pool.execute(
      'SELECT id FROM activities WHERE id = ? AND user_id = ?',
      [activityId, userId]
    );

    if (activities.length === 0) {
      return res.status(404).json({ error: 'Активность не найдена' });
    }

    // Вставляем или обновляем запись о выполнении
    await pool.execute(`
      INSERT INTO activity_logs (activity_id, user_id, completed_date, status, notes)
      VALUES (?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE 
        status = VALUES(status),
        notes = VALUES(notes),
        created_at = CURRENT_TIMESTAMP
    `, [activityId, userId, completedDate, activityStatus, notes || null]);

    res.json({ success: true, message: 'Статус активности обновлен' });

  } catch (error) {
    console.error('Complete activity error:', error);
    res.status(500).json({ error: 'Ошибка при обновлении статуса активности' });
  }
});

// Получить статистику пользователя
app.get('/api/stats', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;

    // Статистика за текущую неделю
    const [weekStats] = await pool.execute(`
      SELECT 
        COUNT(DISTINCT a.id) as total_activities,
        COUNT(DISTINCT al.activity_id) as completed_activities,
        COALESCE(ROUND((COUNT(DISTINCT al.activity_id) / COUNT(DISTINCT a.id)) * 100, 2), 0) as completion_rate
      FROM activities a
      LEFT JOIN activity_logs al ON a.id = al.activity_id 
        AND al.completed_date >= DATE_SUB(CURDATE(), INTERVAL WEEKDAY(CURDATE()) DAY)
        AND al.completed_date <= DATE_ADD(DATE_SUB(CURDATE(), INTERVAL WEEKDAY(CURDATE()) DAY), INTERVAL 6 DAY)
        AND al.status = 'completed'
        AND al.user_id = ?
      WHERE a.user_id = ? AND a.is_active = TRUE
    `, [userId, userId]);

    // Статистика за последние 7 дней
    const [dailyStats] = await pool.execute(`
      SELECT 
        al.completed_date,
        COUNT(al.id) as completed_count
      FROM activity_logs al
      INNER JOIN activities a ON al.activity_id = a.id
      WHERE al.user_id = ? 
        AND a.is_active = TRUE
        AND al.status = 'completed'
        AND al.completed_date >= DATE_SUB(CURDATE(), INTERVAL 6 DAY)
      GROUP BY al.completed_date
      ORDER BY al.completed_date
    `, [userId]);

    res.json({
      success: true,
      stats: {
        week: weekStats[0] || { total_activities: 0, completed_activities: 0, completion_rate: 0 },
        daily: dailyStats
      }
    });

  } catch (error) {
    console.error('Get stats error:', error);
    res.status(500).json({ error: 'Ошибка при получении статистики' });
  }
});

// Проверка соединения с БД
app.get('/api/health', async (req, res) => {
  try {
    await pool.execute('SELECT 1');
    res.json({ status: 'OK', message: 'База данных подключена' });
  } catch (error) {
    res.status(500).json({ status: 'ERROR', message: 'Ошибка подключения к базе данных' });
  }
});

// Запуск сервера
app.listen(PORT, () => {
  console.log(`Сервер запущен на порту ${PORT}`);
  console.log(`API доступен на http://localhost:${PORT}/api`);
});

module.exports = app;