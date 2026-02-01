require('dotenv').config();
const express = require('express');
const { createClient } = require('@libsql/client');
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

// Configuración de Turso (o SQLite local si fallan las variables)
let url = process.env.TURSO_DATABASE_URL;
let authToken = process.env.TURSO_AUTH_TOKEN;

// Limpieza y normalización de credenciales
if (url) {
    url = url.trim();
    if (url.startsWith('libsql://')) {
        url = url.replace('libsql://', 'https://');
    }
}

if (authToken) {
    authToken = authToken.trim();
}

console.log('Configuración BD:', url ? `Conectando a ${url}` : 'Usando modo local (file:urls.db)');

const client = createClient({
  url: url || 'file:urls.db',
  authToken: authToken,
});

// Inicializar BD
async function initDb() {
    try {
        await client.execute(`
            CREATE TABLE IF NOT EXISTS urls (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                original_url TEXT NOT NULL,
                short_code TEXT NOT NULL UNIQUE,
                click_count INTEGER DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('Conectado a la base de datos Turso/SQLite.');
    } catch (err) {
        console.error('Error al inicializar la BD:', err);
    }
}

initDb();

// Rutas API

// Acortar URL
app.post('/api/shorten', async (req, res) => {
    const { originalUrl, customCode } = req.body;

    if (!originalUrl) {
        return res.status(400).json({ error: 'La URL original es requerida' });
    }

    try {
        new URL(originalUrl);
    } catch (e) {
        return res.status(400).json({ error: 'URL inválida' });
    }

    let shortCode = customCode ? customCode.trim() : nanoid(6);

    try {
        // Verificar existencia
        const checkResult = await client.execute({
            sql: 'SELECT short_code FROM urls WHERE short_code = ?',
            args: [shortCode]
        });

        if (checkResult.rows.length > 0) {
             if (customCode) {
                 return res.status(400).json({ error: 'El código personalizado ya está en uso' });
             }
             shortCode = nanoid(6);
        }

        await client.execute({
            sql: 'INSERT INTO urls (original_url, short_code) VALUES (?, ?)',
            args: [originalUrl, shortCode]
        });
            
        const protocol = req.protocol;
        const host = req.get('host');
        const fullShortUrl = `${protocol}://${host}/${shortCode}`;

        res.json({
            originalUrl,
            shortCode,
            shortUrl: fullShortUrl
        });

    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: err.message });
    }
});

// Obtener estadísticas
app.get('/api/stats', async (req, res) => {
    try {
        const result = await client.execute('SELECT * FROM urls ORDER BY created_at DESC');
        
        const protocol = req.protocol;
        const host = req.get('host');
        
        const results = result.rows.map(row => ({
            ...row,
            shortUrl: `${protocol}://${host}/${row.short_code}`
        }));

        res.json(results);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: err.message });
    }
});

// Redirección
app.get('/:code', async (req, res) => {
    const { code } = req.params;
    
    if (code === 'favicon.ico') return res.status(404).end();

    try {
        const result = await client.execute({
            sql: 'SELECT original_url FROM urls WHERE short_code = ?',
            args: [code]
        });

        if (result.rows.length > 0) {
            const originalUrl = result.rows[0].original_url;
            
            // Incrementar contador (sin await para no bloquear la redirección)
            client.execute({
                sql: 'UPDATE urls SET click_count = click_count + 1 WHERE short_code = ?',
                args: [code]
            }).catch(console.error);

            res.redirect(originalUrl);
        } else {
            res.redirect('/?error=notfound');
        }
    } catch (err) {
        console.error(err);
        return res.status(500).send('Error interno');
    }
});

app.listen(PORT, () => {
    console.log(`Servidor corriendo en el puerto ${PORT}`);
});
