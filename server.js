// require serverless version
const app = require('./index.js')

// create local server
app.listen(7515, function () {
    console.log('Addon active on port 7515.');
    console.log('http://127.0.0.1:7515/[imdb-list-id]/manifest.json');
});