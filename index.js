
const express = require('express')
const app = express()
const cors = require('cors')
const qs = require('querystring')

app.use(cors())

const manifest = {
	id: 'org.imdblist',
	version: '0.0.2',
	name: 'IMDB List Add-on',
	description: 'Add-on to create a catalog from IMDB lists.',
	resources: ['catalog'],
	types: ['movie', 'series'],
	catalogs: [
		{
			id: 'imdb-movie-list',
			name: 'IMDB Movie List',
			type: 'movie',
			genres: ["Action", "Adventure", "Animation", "Biography", "Comedy", "Crime", "Documentary", "Drama", "Family", "Fantasy", "Film Noir", "History", "Horror", "Music", "Musical", "Mystery", "Romance", "Sci-Fi", "Short Film", "Sport", "Superhero", "Thriller", "War", "Western"],
			extra: [{ name: 'skip' },{ name: 'genre' }]
		}, {
			id: 'imdb-series-list',
			name: 'IMDB Series List',
			type: 'series',
			genres: ["Action", "Adventure", "Animation", "Biography", "Comedy", "Crime", "Documentary", "Drama", "Family", "Fantasy", "Film Noir", "History", "Horror", "Music", "Musical", "Mystery", "Romance", "Sci-Fi", "Short Film", "Sport", "Superhero", "Thriller", "War", "Western"],
			extra: [{ name: 'skip' },{ name: 'genre' }]
		}
	]
}

const listManifest = {}
app.get('/:listId/:sort?/manifest.json', (req, res) => {
	const cacheTag = req.params.listId + '[]' + (req.params.sort || 'list_order')
	function respond(msg) {
		res.setHeader('Cache-Control', 'max-age=86400, public') // one day
		res.setHeader('Content-Type', 'application/json')
		res.send(msg)
	}
	function tryRespond() {
		if (listManifest[cacheTag]) {
			respond(listManifest[cacheTag])
			return true
		} else
			return false
	}
	const responded = tryRespond()
	if (!responded) {
		queue.push({ id: cacheTag }, (err, done) => {
			if (done) {
				const tryAgain = tryRespond()
				if (tryAgain)
					return
			}
			respond(manifest)
		})
	}
})

const needle = require('needle')

const headers = {
	'User-Agent': 'Mozilla/5.0 (Linux; Android 8.0.0; TA-1053 Build/OPR1.170623.026) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/67.0.3368.0 Mobile Safari/537.36',
	'Accept-Language': 'en-US,en;q=0.8',
}

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

function numberWithCommas(x) {
    return x.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function toMeta(obj) {
	const titleYear = obj.primary.year && obj.primary.year[0] ? obj.primary.year.length > 1 ? ' (' + obj.primary.year[0] + '-' + obj.primary.year[1] + ')' : ' (' + obj.primary.year[0] + ')' : ''
	let description = ''
	if ((obj.ratings || {}).rating) {
		if ((obj.ratings || {}).votes)
			description += 'IMDB Rating: ' + obj.ratings.rating + '/10 (' + numberWithCommas(obj.ratings.votes) + ')'
		if ((obj.ratings || {}).metascore)
			description += '\n' + 'Metascore: ' + obj.ratings.metascore + '%'
	}
	if (obj.plot) {
		if (description)
			description += '\n\n'
		description += obj.plot
	}
	return {
		id: obj.id || null,
		name: obj.primary && obj.primary.title ? obj.primary.title + (titleYear || '') : null,
		poster: obj.poster && obj.poster.url ? imageResize(obj.poster.url, 250) : null,
		type: obj.type == 'featureFilm' ? 'movie' : 'series',
		genres: (obj.metadata || {}).genres || [],
		description
	}
}

const sorts = {
	'list_order': 'list_order%2Casc',
	'popularity': 'moviemeter%2Casc',
	'alphabetical': 'alpha%2Casc',
	'rating': 'user_rating%2Cdesc',
	'votes': 'num_votes%2Cdesc',
	'released': 'release_date%2Cdesc',
	'date_added': 'date_added%2Cdesc'
}

const sortsTitle = {
	'list_order': ' by List Order',
	'popularity': ' by Popularity',
	'alphabetical': ' by Alphabetical',
	'rating': ' by Rating',
	'votes': ' by Nr Votes',
	'released': ' by Release Date',
	'date_added': ' by Date Added'
}

const namedQueue = require('named-queue')

const queue = new namedQueue((task, cb) => {
	const listId = task.id.split('[]')[0]
	const sort = task.id.split('[]')[1]
	const skip = task.id.split('[]')[2]
	const page = Math.floor(parseInt(skip) / 50) +1
	const genre = task.id.split('[]')[3]
	let type = task.id.split('[]')[4]

	if (type == 'series')
		type = 'tvSeries'

	if (listId) {
		headers.referer = 'https://m.imdb.com/list/'+listId+'/'
		const getUrl = 'https://m.imdb.com/list/'+listId+'/search?sort='+sorts[sort]+'&view=grid&tracking_tag=&title_type=' + type + '&pageId='+listId+'&pageType=list&page='+page+(genre ? '&genres=' + genre : '')
		needle.get(getUrl, { headers }, (err, resp) => {
			if (!err && resp && resp.body) {
				const cacheTag = task.id
				const jObj = resp.body
				if (jObj.titles && Object.keys(jObj.titles).length) {
					const metas = []
					for (let key in jObj.titles) {
						const el = jObj.titles[key]
						const metaType = el.type == 'featureFilm' ? 'movie' : el.type == 'series' ? 'series' : null
						if (metaType)
							metas.push(toMeta(el))
					}
					if (jObj.list && jObj.list.name) {
						const cloneManifest = JSON.parse(JSON.stringify(manifest))
						cloneManifest.id = 'org.imdblist' + cacheTag
						cloneManifest.name = jObj.list.name + sortsTitle[sort]
						cloneManifest.catalogs.forEach((cat, ij) => {
							cloneManifest.catalogs[ij].name = jObj.list.name + sortsTitle[sort]
						})
						listManifest[cacheTag] = cloneManifest
					}
					cb(false, metas)
					cache[cacheTag] = metas
					setTimeout(() => {
						cache[cacheTag] = []
					}, 86400000)
				} else 
					cb('Parsing error on ajax call')
			} else
				cb(err || 'Error on requesting ajax call')
		})
	} else
		cb('No list id')
}, Infinity)

const cache = {}

app.get('/:listId/:sort?/catalog/:type/:id/:extra?.json', (req, res) => {
	const extra = req.params.extra ? qs.parse(req.url.split('/').pop().slice(0, -5)) : {}
	const skip = extra.skip ? parseInt(extra.skip) : 0
	const cacheTag = req.params.listId + '[]' + (req.params.sort || 'list_order') + '[]' + skip + '[]' + (extra.genre || '') + '[]' + req.params.type
	function fail(err) {
		console.error(err)
		res.writeHead(500)
		res.end(JSON.stringify({ err: 'handler error' }))
	}
	function respond(msg) {
		res.setHeader('Cache-Control', 'max-age=86400') // one day
		res.setHeader('Content-Type', 'application/json')
		res.send(msg)
	}
	function fetch() {
		queue.push({ id: cacheTag }, (err, metas) => {
			if (metas) {
				respond(JSON.stringify({ metas }))
			} else 
				fail(err || 'Could not get list items')
		})
	}
	if (req.params.listId && ['movie','series'].indexOf(req.params.type) > -1) {
		if ((cache[cacheTag] || []).length)
			respond(JSON.stringify({ metas: cache[cacheTag] }))
		else
			fetch()
	} else
		fail('Unknown request parameters')
})

module.exports = app
