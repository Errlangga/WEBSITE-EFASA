require('dotenv').config();
const app = require('./server/app');

const PORT = Number(process.env.PORT || 3000);

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`EFASA TEKNIK berjalan di http://localhost:${PORT}`);
    console.log(`Admin setup: http://localhost:${PORT}/admin/setup`);
  });
}

module.exports = app;
