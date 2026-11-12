// Local server: binds to 127.0.0.1 only.
import app from './app.js';

const PORT = Number(process.env.PORT) || 4317;

app.listen(PORT, '127.0.0.1', () => {
  console.log(`Job Matcher running at http://localhost:${PORT}`);
});
