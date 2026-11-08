// Локальний сервер сайту — як на GitHub Pages: адреси без .html, /tools/ → tools/index.html, 404.html.
//   npm start            → http://localhost:8080
//   PORT=3000 npm start
import { startServer } from '../tests/_harness.mjs';

const { url } = await startServer(+(process.env.PORT || 8080));
console.log(`Edvault: ${url}  (Ctrl+C — зупинити)`);
