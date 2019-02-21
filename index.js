
const express = require('express')
const app = express()
const cors = require('cors')

app.use(cors())

const manifest = {
	id: 'org.imdblist',
	version: '0.0.1',
	name: 'IMDB List Add-on',
	description: 'Add-on to create a catalog from IMDB lists.',
	resources: ['catalog'],
	types: ['movie', 'series'],
	catalogs: [
		{
			id: 'imdb-movie-list',
			name: 'IMDB Movie List',
			type: 'movie'
		}, {
			id: 'imdb-series-list',
			name: 'IMDB Series List',
			type: 'series'
		}
	]
}

const listManifest = {}

app.get('/:listId/:sort?/manifest.json', (req, res) => {
	const cacheTag = req.params.listId + '[]' + (req.params.sort || 'list_order')
	function respond() {
		if (listManifest[cacheTag]) {
			res.send(listManifest[cacheTag])
			return true
		} else
			return false
	}
	const responded = respond()
	if (!responded) {
		queue.push({ id: cacheTag }, (err, done) => {
			if (done) {
				const tryAgain = respond()
				if (tryAgain)
					return
			}
			res.send(manifest)
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

function toMeta(obj) {
	const titleYear = obj.primary.year && obj.primary.year[0] ? obj.primary.year.length > 1 ? ' (' + obj.primary.year[0] + '-' + obj.primary.year[1] + ')' : ' (' + obj.primary.year[0] + ')' : ''
	return {
		id: obj.id || null,
		name: obj.primary && obj.primary.title ? obj.primary.title + (titleYear || '') : null,
		poster: obj.poster && obj.poster.url ? imageResize(obj.poster.url, 250) : null,
		type: obj.type == 'featureFilm' ? 'movie' : 'series'
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

function getList(listId, sort, cb) {
	if (listId) {
		headers.referer = 'https://m.imdb.com/list/'+listId+'/'
		const getUrl = 'https://m.imdb.com/list/'+listId+'/search?sort='+sorts[sort]+'&view=grid&tracking_tag=&pageId='+listId+'&pageType=list'
		needle.get(getUrl, { headers }, (err, resp) => {
			if (!err && resp && resp.body) {
				const cacheTag = listId + '[]' + sort
				const jObj = resp.body
				if (jObj.titles && Object.keys(jObj.titles).length) {
					manifest.types.forEach(el => { cache[el][cacheTag] = [] })
					for (let key in jObj.titles) {
						const el = jObj.titles[key]
						const metaType = el.type == 'featureFilm' ? 'movie' : el.type == 'series' ? 'series' : null
						if (metaType) {
							cache[metaType][cacheTag].push(toMeta(el))
						}
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
					setTimeout(() => {
						manifest.types.forEach(el => { cache[el][cacheTag] = [] })
					}, 86400000)
					cb(false, true)
				} else 
					cb('Parsing error on ajax call')
			} else
				cb(err || 'Error on requesting ajax call')
		})
	} else
		cb('No list id')
}

const namedQueue = require('named-queue')

const queue = new namedQueue((task, cb) => {
	const id = task.id.split('[]')[0]
	const sort = task.id.split('[]')[1]
	getList(id, sort, cb)
}, Infinity)

const cache = { movie: {}, series: {} }

app.get('/:listId/:sort?/catalog/:type/:id.json', (req, res) => {
	const cacheTag = req.params.listId + '[]' + (req.params.sort || 'list_order')
	function fail(err) {
		console.error(err)
		res.writeHead(500)
		res.end(JSON.stringify({ err: 'handler error' }))
	}
	function fetch() {
		queue.push({ id: cacheTag }, (err, done) => {
			if (done) {
				const userData = cache[req.params.type][cacheTag]
				res.send(JSON.stringify({ metas: userData }))
			} else 
				fail(err || 'Could not get list items')
		})
	}
	if (req.params.listId && ['movie','series'].indexOf(req.params.type) > -1) {
		if (cache[req.params.type][cacheTag]) {
			const userData = cache[req.params.type][cacheTag]
			if (userData.length)
				res.send(JSON.stringify({ metas: userData }))
			else
				fetch()
		} else
			fetch()
	} else
		fail('Unknown request parameters')
})

module.exports = app
