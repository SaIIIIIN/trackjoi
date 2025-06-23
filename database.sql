-- База данных для приложения TrackJoi
-- Поддерживает MySQL и PostgreSQL

-- Таблица пользователей
CREATE TABLE users (
    id INT PRIMARY KEY AUTO_INCREMENT,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    last_login TIMESTAMP NULL,
    is_active BOOLEAN DEFAULT TRUE
);

-- Таблица активностей/привычек
CREATE TABLE activities (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    reminder BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    is_active BOOLEAN DEFAULT TRUE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Таблица дней недели для активностей
CREATE TABLE activity_days (
    id INT PRIMARY KEY AUTO_INCREMENT,
    activity_id INT NOT NULL,
    day_of_week ENUM('пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'нд') NOT NULL,
    FOREIGN KEY (activity_id) REFERENCES activities(id) ON DELETE CASCADE,
    UNIQUE KEY unique_activity_day (activity_id, day_of_week)
);

-- Таблица записей выполнения активностей
CREATE TABLE activity_logs (
    id INT PRIMARY KEY AUTO_INCREMENT,
    activity_id INT NOT NULL,
    user_id INT NOT NULL,
    completed_date DATE NOT NULL,
    status ENUM('completed', 'skipped', 'missed') DEFAULT 'completed',
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (activity_id) REFERENCES activities(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE KEY unique_activity_date (activity_id, completed_date)
);

-- Таблица статистики пользователей
CREATE TABLE user_stats (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    week_start DATE NOT NULL,
    total_activities INT DEFAULT 0,
    completed_activities INT DEFAULT 0,
    completion_rate DECIMAL(5,2) DEFAULT 0.00,
    streak_count INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE KEY unique_user_week (user_id, week_start)
);

-- Таблица настроек пользователей
CREATE TABLE user_settings (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    setting_key VARCHAR(100) NOT NULL,
    setting_value TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE KEY unique_user_setting (user_id, setting_key)
);

-- Индексы для оптимизации запросов
CREATE INDEX idx_activities_user_id ON activities(user_id);
CREATE INDEX idx_activities_created_at ON activities(created_at);
CREATE INDEX idx_activity_logs_user_id ON activity_logs(user_id);
CREATE INDEX idx_activity_logs_date ON activity_logs(completed_date);
CREATE INDEX idx_activity_logs_status ON activity_logs(status);
CREATE INDEX idx_user_stats_week ON user_stats(week_start);

-- Представления для часто используемых запросов

-- Представление активностей с днями недели
CREATE VIEW activities_with_days AS
SELECT 
    a.id,
    a.user_id,
    a.name,
    a.description,
    a.reminder,
    a.created_at,
    a.is_active,
    GROUP_CONCAT(ad.day_of_week ORDER BY 
        CASE ad.day_of_week 
            WHEN 'пн' THEN 1 
            WHEN 'вт' THEN 2 
            WHEN 'ср' THEN 3 
            WHEN 'чт' THEN 4 
            WHEN 'пт' THEN 5 
            WHEN 'сб' THEN 6 
            WHEN 'нд' THEN 7 
        END
    ) as days
FROM activities a
LEFT JOIN activity_days ad ON a.id = ad.activity_id
WHERE a.is_active = TRUE
GROUP BY a.id, a.user_id, a.name, a.description, a.reminder, a.created_at, a.is_active;

-- Представление текущего прогресса активностей
CREATE VIEW current_week_progress AS
SELECT 
    a.id as activity_id,
    a.user_id,
    a.name,
    COUNT(ad.day_of_week) as planned_days,
    COUNT(al.id) as completed_days,
    COALESCE(ROUND((COUNT(al.id) / COUNT(ad.day_of_week)) * 100, 2), 0) as completion_percentage
FROM activities a
LEFT JOIN activity_days ad ON a.id = ad.activity_id
LEFT JOIN activity_logs al ON a.id = al.activity_id 
    AND al.completed_date >= DATE_SUB(CURDATE(), INTERVAL WEEKDAY(CURDATE()) DAY)
    AND al.completed_date <= DATE_ADD(DATE_SUB(CURDATE(), INTERVAL WEEKDAY(CURDATE()) DAY), INTERVAL 6 DAY)
    AND al.status = 'completed'
WHERE a.is_active = TRUE
GROUP BY a.id, a.user_id, a.name;

-- Тестовые данные для разработки
INSERT INTO users (email, password_hash) VALUES 
('test@example.com', '$2b$10$example_hash_here'),
('user2@example.com', '$2b$10$another_hash_here');

INSERT INTO activities (user_id, name, description, reminder) VALUES 
(1, 'Ранкова зарядка', 'Зарядка на 15 хвилин', TRUE),
(1, 'Читання книг', 'Читати мінімум 30 хвилин на день', FALSE),
(1, 'Пити воду', 'Випивати 8 склянок води', TRUE);

INSERT INTO activity_days (activity_id, day_of_week) VALUES 
(1, 'пн'), (1, 'ср'), (1, 'пт'),
(2, 'пн'), (2, 'вт'), (2, 'ср'), (2, 'чт'), (2, 'пт'),
(3, 'пн'), (3, 'вт'), (3, 'ср'), (3, 'чт'), (3, 'пт'), (3, 'сб'), (3, 'нд');