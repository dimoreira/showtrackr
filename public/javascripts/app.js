var showTrackr = angular.module('showTrackr', [
	'ngCookies',
	'ngResource',
	'ngMessages',
	'ngRoute',
	'mgcrea.ngStrap'
])
.config([ '$locationProvider', '$routeProvider', function($locationProvider, $routeProvider) {
	$locationProvider.html5Mode(true);

	$routeProvider
	.when('/', {
		templateUrl: 'views/home.html',
		controller: 'MainCtrl'
	})
	.when('/shows/:id', {
		templateUrl: 'views/detail.html',
		controller: 'DetailCtrl'
	})
	.when('/add', {
		templateUrl: 'views/add.html',
		controller: 'AddCtrl'
	})
	.otherwise({
		redirectTo: '/'
	});
}]);
