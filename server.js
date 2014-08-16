var express = require('express');
var path = require('path');
var logger = require('morgan');
var cookieParser = require('cookie-parser');
var bodyParser = require('body-parser');
var mongoose = require('mongoose');
var bcrypt = require('bcryptjs');
var async = require('async');
var request = require('request');
var xml2js = require('xml2js');
var _ = require('lodash');
var session = require('express-session');
var passport = require('passport');
var LocalStrategy = require('passport-local').Strategy;

var showSchema = new mongoose.Schema({
	_id: Number,
	name: String,
	airsDayOfWeek: String,
	airsTime: String,
	firstAired: Date,
	genre: [String],
	network: String,
	overview: String,
	rating: Number,
	ratingCount: Number,
	status: String,
	poster: String,
	subscribers: [{
		type: mongoose.Schema.Types.ObjectId, ref: 'User'
	}],
	episodes: [{
		season: Number,
		episodeNumber: Number,
		episodeName: String,
		firstAired: Date,
		overview: String
	}]
});

var userSchema = new mongoose.Schema({
	email: { type: String, unique: true },
	password: String
});

userSchema.pre('save', function(next) {
	var user = this;
	if (!user.isModified('password')) return next();
	bcrypt.genSalt(10, function(err, salt) {
		if (err) return next(err);
		bcrypt.hash(user.password, salt, function(err, hash) {
			if (err) return next(err);
			user.password = hash;
			next();
		});
	});
});

userSchema.methods.comparePassword = function(candidatePassword, cb) {
	bcrypt.compare(candidatePassword, this.password, function(err, isMatch) {
		if (err) return cb(err);
		cb(null, isMatch);
	});
};

var User = mongoose.model('User', userSchema);
var Show = mongoose.model('Show', showSchema);
mongoose.connect('localhost');

passport.serializeUser(function(user, done) {
	done(null, user.id);
});

passport.deserializeUser(function(id, done) {
	User.findById(id, function(err, user) {
		done(err, user);
	});
});

passport.use(new LocalStrategy({ usernameField: 'email' }, function(email, password, done) {
	User.findOne({ email: email }, function(err, user) {
		if (err) return done(err);
		if (!user) return done(null, false);
		user.comparePassword(password, function(err, isMatch) {
			if (err) return done(err);
			if (isMatch) return done(null, user);
			return done(null, false);
		});
	});
}));

function ensureAuthenticated(req, res, next) {
	if (req.isAuthenticated()) next();
	else res.status(401);
};

var app = module.exports = express();

app.set('port', process.env.PORT || 5000);
app.use(logger('dev'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(session({ secret: 'keyboard cat' }));
app.use(passport.initialize());
app.use(passport.session());
app.use(express.static(path.join(__dirname, 'public')));

/* AUTHENTICATION MIDDLEWARE */
app.use(function(req, res, next) {
	if (req.user) {
		res.cookie('user', JSON.stringify(req.user));
	}
	next();
});

/* ROUTES */

/* GET /api/shows */
app.get('/api/shows', function(req, res, next) {
	var query = Show.find();
	if (req.query.genre) {
		query.where({ genre: req.query.genre });
	} else {
		query.limit(12);
	}
	query.exec(function(err, shows) {
		if (err) return next(err);
		res.json(shows);
	});
});

/* GET /api/shows/:id */
app.get('/api/shows/:id', function(req, res, next) {
	Show.findById(req.params.id, function(err, show) {
		if (err) return next(err);
		res.json(show);
	})
});

/* POST /api/shows */
app.post('/api/shows', function(req, res, next) {
	var apiKey = '9EF1D1E7D28FDA0B';
	var parser = xml2js.Parser({
		explicitArray: false,
		normalizeTags: true
	});
	var seriesName = req.body.showName.toLowerCase().replace(/ /g, '_').replace(/[^\w-]+/g, '');
	async.waterfall([
		function(callback) {
			var url = 'http://thetvdb.com/api/GetSeries.php?seriesname=' + seriesName;
			request.get(url, function(error, response, body) {
				if (error) return next(error);
				parser.parseString(body, function(err, result) {
					if (!result.data.series) {
						return res.status(404).send({ message: req.body.showName + ' was not found.' });
					}
					var seriesId = result.data.series.seriesid || result.data.series[0].seriesid;
					callback(err, seriesId);
				});
			});
		},
		function(seriesId, callback) {
			var url = 'http://thetvdb.com/api/' + apiKey + '/series/' + seriesId + '/all/en.xml';
			request.get(url, function(error, response, body) {
				if (error) return next(error);
				parser.parseString(body, function(err, result) {
					var series = result.data.series;
					var episodes = result.data.episode;
					var show = new Show({
						_id: series.id,
						name: series.seriesname,
						airsDayOfWeek: series.airs_dayofweek,
						airsTime: series.airs_time,
						firstAired: series.firstaired,
						genre: series.genre.split('|').filter(Boolean),
						network: series.network,
						overview: series.overview,
						rating: series.rating,
						ratingCount: series.ratingcount,
						runtime: series.runtime,
						status: series.status,
						poster: series.poster,
						episodes: []
					});
					_.each(episodes, function(episode) {
						show.episodes.push({
							season: episode.seasonnumber,
							episodeNumber: episode.episodenumber,
							episodeName: episode.episodename,
							firstAired: episode.firstaired,
							overview: episode.overview
						});
					});
					callback(err, show);
				});
			});
		},
		function(show, callback) {
			var url = 'http://thetvdb.com/banners/' + show.poster;
			request({
				url: url,
				encoding: null
			}, function(error, response, body) {
				show.poster = 'data:' + response.headers['content-type'] + ';base64,' + body.toString('base64');
				callback(error, show);
			});
		}
	], function(err, show) {
		if (err) return next(err);
		show.save(function(err) {
			if (err) {
				if (err.code == 11000) {
					return res.status(409).send({ message: show.name + ' already exists' });
				}
				return next(err);
			}
			res.status(200);
		});
	});
});

/* POST /api/login */ 
app.post('/api/login', passport.authenticate('local'), function(req, res) {
	res.cookie('user', JSON.stringify(req.user));
	res.json(req.user);
});

/* POST /api/signup */ 
app.post('/api/signup', function(req, res,next) {
	var user = new User({
		email: req.body.email,
		password: req.body.password
	});
	user.save(function(err) {
		if (err) return next(err);
		res.status(200);
	});
});

/* GET /api/logout */
app.get('/api/logout', function(req, res, next) {
	req.logout();
	res.status(200);
});

app.get('*', function(req, res) {
	res.redirect('/#' + req.originalUrl);
});

/* ERROR MIDDLEWARE */
app.use(function(err, req, res, next) {
	console.error(err.stack);
	res.status(500).json({ message: err.message });
});

app.listen(app.get('port'), function() {
	console.log('Express server listening on port ' + app.get('port'));
});
