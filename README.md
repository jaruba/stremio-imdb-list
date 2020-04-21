# Stremio Add-on to Add an IMDB List as a Catalog

This is a simple add-on that uses an ajax call to get a list of items from IMDB, then converts those items to Stremio supported Meta Objects.


## Using locally

**Pre-requisites: Node.js, Git**

```
git clone https://github.com/jaruba/stremio-imdb-list.git
cd stremio-imdb-list
npm i
npm start
```

This will print `http://127.0.0.1:7515/[imdb-list-id]/manifest.json`. Add a IMDB list id instead of `[imdb-list-id]` in this URL and [load the add-on in Stremio](https://github.com/jaruba/stremio-imdb-list#6-install-add-on-in-stremio).


## Using remotely

Use `https://1fe84bc728af-imdb-list.beamup.dev/[imdb-list-id]/manifest.json`. Add a IMDB list id instead of `[imdb-list-id]` in this URL and [load the add-on in Stremio](https://github.com/jaruba/stremio-imdb-list#6-install-add-on-in-stremio).


## What is a IMDB List ID

Presuming that the list you want to add is `https://www.imdb.com/list/ls058289969/`, the IMDB list id in this case is `ls058289969`.


## Sorting Lists

You can also sort these lists, supported sorting tags: `list_order`, `popularity`, `alphabetical`, `rating`, `votes`, `released`, `date_added`

The default sorting is: `list_order`

To get a list of sorted items, use: `https://1fe84bc728af-imdb-list.beamup.dev/[imdb-list-id]/[tag-id]/manifest.json`

Example: `https://1fe84bc728af-imdb-list.beamup.dev/ls058289969/alphabetical/manifest.json`


## How this add-on was made


### 1. Create a `package.json` and add dependencies

```json
{
  "name": "stremio-imdb-list",
  "version": "0.0.1",
  "description": "Add-on to create a Stremio catalog from a IMDB list.",
  "main": "index.js",
  "scripts": {
    "start": "node index.js"
  },
  "dependencies": {
    "needle": "^2.2.4",
    "express": "^4.16.4",
    "cors": "^2.8.5",
    "named-queue": "^2.2.1"
  }
}
```

We will use `needle` to make the ajax request, `express` to create the add-on http server, `cors` to easily add CORS to our http server responses and `named-queue` because although we'll get two catalog requests (one for movies and one for series), we only need to do one ajax request as IMDB lists include both. That's where `named-queue` comes in, as it merges tasks by `id`, so we only do one ajax request to respond to both catalog requests.


### 2. Add-on manifest

In this step, we define the add-on name, description and purpose.

Create an `index.js` file:

```javascript
const manifest = {

  // set add-on id, any string unique between add-ons
  id: 'org.imdblist',

  // setting a semver add-on version is mandatory
  version: '0.0.1',

  // human readable add-on name
  name: 'IMDB List Add-on',

  // description of the add-on
  description: 'Add-on to create a catalog from a IMDB list.',

  // we only need 'catalog' for this add-on, can also be 'meta', 'stream' and 'subtitles'
  resources: ['catalog'],

  // we set the add-on types, can also be 'tv', 'channel' and 'other'
  types: ['movie', 'series'],

  // we define our catalogs, we'll make one for 'movies' and one for 'series'
  catalogs: [
    {
      // id of catalog, any string unique between this add-ons catalogs
      id: 'imdb-movie-list',

      // human readable catalog name
      name: 'IMDB Movie List',

      // the type of this catalog provides
      type: 'movie'
    }, {
      id: 'imdb-series-list',
      name: 'IMDB Series List',
      type: 'series'
    }
  ]
}

// create add-on server
const express = require('express')
const app = express()
const cors = require('cors')

// add CORS to server responses
app.use(cors())

// respond to the manifest request
app.get('/:listId/manifest.json', (req, res) => {
  res.setHeader('Cache-Control', 'max-age=604800') // one week
  res.setHeader('Content-Type', 'application/json')
  res.send(manifest)
})
```

### 3. Get List Items

Now we need to get the list items based on list id (we'll use an ajax call for that), then convert the items in the list to Stremio meta objects, and also resize the list item poster (by modifying the poster url) to something significantly smaller for the Stremio catalog.

```javascript
// we'll use a helper function to resize IMDB posters
// their normally too big for catalog responses
function imageResize(posterUrl, width) {
  if (!posterUrl) return null
  if (!posterUrl.includes('amazon.com') && !posterUrl.includes('imdb.com')) return posterUrl
  if (posterUrl.includes('._V1_.')) posterUrl = posterUrl.replace('._V1_.', '._V1_SX' + width + '.')
  else if (posterUrl.includes('._V1_')) {
    var extension = posterUrl.split('.').pop()
    posterUrl = posterUrl.substr(0,posterUrl.indexOf('._V1_')) + '._V1_SX' + width + '.' + extension
  }
  return posterUrl
}

// we'll also need a function to convert the IMDB List
// items to a Stremio Meta object
function toMeta(obj) {
  // we need minimal data for catalogs, we'll set the IMDB id as
  // the meta object id, so the cinemeta add-on can handle the
  // meta requests for them afterwards
  return {
    id: obj.id || null,
    name: obj.primary && obj.primary.title ? obj.primary.title : null,
    poster: obj.poster && obj.poster.url ? imageResize(obj.poster.url, 250) : null,
    type: obj.type == 'featureFilm' ? 'movie' : 'series'
  }
}

const needle = require('needle')

// request headers for the ajax call
const headers = {
  // we set the user agent of Chrome on Android
  'User-Agent': 'Mozilla/5.0 (Linux; Android 8.0.0; TA-1053 Build/OPR1.170623.026) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/67.0.3368.0 Mobile Safari/537.36',
  // we set the language we expect from the page
  'Accept-Language': 'en-US,en;q=0.8',
}

// declare our cache object
const cache = { movie: {}, series: {} }

// we make a function to handle fetching the IMDB list
function getList(listId, cb) {

  if (listId) {

    // we set the normal url of IMDB lists as the
    // referer for the request
    headers.referer = 'https://m.imdb.com/list/'+listId+'/'

    // this is our ajax call, based on IMDB list ID
    const getUrl = 'https://m.imdb.com/list/'+listId+'/search?sort=date_added%2Cdesc&view=grid&tracking_tag=&pageId='+listId+'&pageType=list'

    needle.get(getUrl, { headers }, (err, resp) => {
      if (!err && resp && resp.body) {
        // our request is successful and we have a body
        const jObj = resp.body
        if (jObj.titles && Object.keys(jObj.titles).length) {

          // this list has items

          // we empty the cache for this list
          manifest.types.forEach(el => { cache[el][listId] = [] })

          // iterate through items object and add to our cache
          for (let key in jObj.titles) {
            const el = jObj.titles[key]
            const metaType = el.type == 'featureFilm' ? 'movie' : el.type == 'series' ? 'series' : null
            if (metaType) {
              cache[metaType][listId].push(toMeta(el))
            }
          }

          // remove cache after 1 day
          setTimeout(() => {
            manifest.types.forEach(el => { cache[el][listId] = [] })
          }, 86400000)

          // respond with no error, cache has been updated succesfully
          cb(false, true)
        } else {
          // send error
          cb('Parsing error on ajax call')
        }
      } else {
        // send error
        cb(err || 'Error on requesting ajax call')
      }
    })
  } else {
    // send error
    cb('No list id')
  }
}
```


### 4. Catalog Handler

We create the catalog handler, get the list id from the user as it's part of the add-on url and merge http requests for the same list id.

```javascript

// we use `named-queue` to merge more tasks
// with the same list id
const namedQueue = require('named-queue')

const queue = new namedQueue((task, cb) => {
  getList(task.id, cb)
}, Infinity)

// users pass the list id in the add-on url
// this will be available as `req.params.listId`
app.get('/:listId/catalog/:type/:id.json', (req, res) => {

  // handle failures
  function fail(err) {
    console.error(err)
    res.writeHead(500)
    res.end(JSON.stringify({ err: 'handler error' }))
  }

  // handle response
  function respond(msg) {
    res.setHeader('Cache-Control', 'max-age=86400') // one day
    res.setHeader('Content-Type', 'application/json')
    res.send(msg)
  }

  // handle importing and updating cache
  function fetch() {
    queue.push({ id: req.params.listId }, (err, done) => {
      if (done) {
        const userData = cache[req.params.type][req.params.listId]
        respond(JSON.stringify({ metas: userData }))
      } else 
        fail(err || 'Could not get list items')
    })
  }

  // ensure request parameters are known
  if (req.params.listId && ['movie','series'].indexOf(req.params.type) > -1) {

    // if we already have it in the cache, use the cache
    if (cache[req.params.type][req.params.listId]) {
      const userData = cache[req.params.type][req.params.listId]
      if (userData.length)
        respond(JSON.stringify({ metas: userData }))
      else
        fetch()
    } else
      fetch()

  } else
    fail('Unknown request parameters')
})
```

### 5. Run the Add-on Server

```javascript
app.listen(7515, () => {
    console.log('http://127.0.0.1:7515/[imdb-list-id]/manifest.json')
})
```

### 6. Install Add-on in Stremio

![addlink](https://user-images.githubusercontent.com/1777923/43146711-65a33ccc-8f6a-11e8-978e-4c69640e63e3.png)
