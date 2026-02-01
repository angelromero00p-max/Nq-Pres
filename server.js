const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { nanoid } = require('nanoid');
const cors = require('cors');
const path = require('path');
const bodyParser = require('body-parser');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// Base de datos SQLite
// En Render con Persistent Disk, usaremos una ruta absoluta (ej: /var/data/urls.db)
// Si no se define DB_PATH, se usa el archivo local
const dbPath = process.env.DB_PATH || path.join(__dirname, 'urls.db');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error al conectar con la base de datos:', err.message);
    } else {
        console.log('Conectado a la base de datos SQLite.');
        initDb();
    }
});

function initDb() {
    db.run(`CREATE TABLE IF NOT EXISTS urls (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        original_url TEXT NOT NULL,
        short_code TEXT NOT NULL UNIQUE,
        click_count INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
}

// Rutas API

// Acortar URL
app.post('/api/shorten', (req, res) => {
    const { originalUrl, customCode } = req.body;

    if (!originalUrl) {
        return res.status(400).json({ error: 'La URL original es requerida' });
    }

    // Validar URL simple
    try {
        new URL(originalUrl);
    } catch (e) {
        return res.status(400).json({ error: 'URL inválida' });
    }

    let shortCode = customCode ? customCode.trim() : nanoid(6);

    // Verificar si el código ya existe (especialmente para customCode o colisiones raras)
    const checkSql = 'SELECT short_code FROM urls WHERE short_code = ?';
    db.get(checkSql, [shortCode], (err, row) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        if (row) {
             if (customCode) {
                 return res.status(400).json({ error: 'El código personalizado ya está en uso' });
             }
             // Si fue generado automáticamente y colisionó (muy raro), regeneramos una vez
             shortCode = nanoid(6);
        }

        const insertSql = 'INSERT INTO urls (original_url, short_code) VALUES (?, ?)';
        db.run(insertSql, [originalUrl, shortCode], function(err) {
            if (err) {
                return res.status(500).json({ error: err.message });
            }
            
            // Construir la URL completa basada en el host actual
            // Esto permite que funcione con cualquier dominio sin configuración extra
            const protocol = req.protocol;
            const host = req.get('host');
            const fullShortUrl = `${protocol}://${host}/${shortCode}`;

            res.json({
                originalUrl,
                shortCode,
                shortUrl: fullShortUrl
            });
        });
    });
});

// Obtener estadísticas (todas las URLs)
app.get('/api/stats', (req, res) => {
    const sql = 'SELECT * FROM urls ORDER BY created_at DESC';
    db.all(sql, [], (err, rows) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        
        // Agregar la URL completa a cada resultado para facilitar el frontend
        const protocol = req.protocol;
        const host = req.get('host');
        
        const results = rows.map(row => ({
            ...row,
            shortUrl: `${protocol}://${host}/${row.short_code}`
        }));

        res.json(results);
    });
});

// Redirección
app.get('/:code', (req, res) => {
    const { code } = req.params;
    
    // Ignorar favicon
    if (code === 'favicon.ico') return res.status(404).end();

    const sql = 'SELECT original_url FROM urls WHERE short_code = ?';
    db.get(sql, [code], (err, row) => {
        if (err) {
            return res.status(500).send('Error interno');
        }
        if (row) {
            // Incrementar contador asíncronamente
            db.run('UPDATE urls SET click_count = click_count + 1 WHERE short_code = ?', [code]);
            res.redirect(row.original_url);
        } else {
            // Si no existe, redirigir a home o mostrar 404
            res.redirect('/?error=notfound');
        }
    });
});

app.listen(PORT, () => {
    console.log(`Servidor corriendo en el puerto ${PORT}`);
});
