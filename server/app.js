'use strict';

// Primary server file
var express = require('express');
var app = express();

var mongoose = require('mongoose');
var database = require('./config/developmentdb.js');

var $storage = require('./storage.js');

var http = require('http');
http = http.Server(app);

var io = require('socket.io');
io = io(http);

var shuffle = require('knuth-shuffle');

// Require bluebird so that as soon as req comes in, promisify it.
var port = process.env.PORT || 8085;

// Require middleware (also handles initial API routing)
require('./config/middleware.js')(app, express);

// // Require database connections
// // mongoose.connect(database); // connect to mongo database named 'areyouarobot-dev'
mongoose.connect('mongodb://localhost/areyouarobot-dev');
// // Seed the MongoDB with sample user data

if(database.seedDB) { require('./config/seed'); };

http.listen(port);
console.log('Server running on port %d', port);

// *************************** SOCKET.IO STUFF ***************************** //

var activeGames = {};

io.on('connection', function(socket) {
	// console when a user connects to the game and nest all events within
	console.log('user connected');

	// listen for user disconnecting and console log
	socket.on('disconnect', function() {
		console.log('user disconnected');
	});
	
	// listen for creation of new game using roomID
	socket.on('createGame', function(gameInfo) {
		
		// player joined, passing in gameID and playerName through gameInfo
		console.log('got a player in createGame on server', gameInfo);

		// create temp room variable to store the room
		var room = gameInfo.gameID;
		console.log(room);

		// store "nickname" used for playerName (as opposed to socket.id)
		socket.nickname = gameInfo.playerName;

		// join room
		socket.join(room);

		// create a new game to be stored in gameStorage
		var newGame = {
			room: room,
			players: [{
				playerName: socket.nickname,
				playerID: socket.id
			}],
			currentGuesserIndex: 0,
			question: '',
			answers: [],
			guesserChoice: '',
			gameResult: ''
		};

		activeGames[room] = newGame;

		// store newGame instance in the service
		// io.emit('saveNewGame', newGame);
	});

	// listen for creation/joining of new game using roomID
	socket.on('joinGame', function(gameInfo) {
		// player joined, passing in gameID and playerName through gameInfo
		console.log('got a player', gameInfo);

		// create temp room variable to store the room
		var room = gameInfo.gameID;
		console.log(room);

		// store "nickname" used for playerName (as opposed to socket.id)
		socket.nickname = gameInfo.playerName;

		// join room
		socket.join(room);

		// update existing game with new player
		// io.emit('updateExistingGame', {
		// 	room: room,
		// 	playerName: socket.nickname,
		// 	playerID: socket.id
		// });

		activeGames[room].players.push({
			playerName: socket.nickname,
			playerID: socket.id
		});

		if (activeGames[room].players.length === 3) {
			console.log('starting new game in five seconds!');
			setTimeout(function() {
				console.log('starting game in gameInstance', activeGames[room]);
				
				// send different messages to guesser and panel to start game
				for (var i = 0; i < activeGames[room].players.length; i++) {
					if (i === activeGames[room].currentGuesserIndex) {
						io.sockets.connected[activeGames[room].players[i].playerID].emit('startGuesser', activeGames[room]);		
					} else {
						io.sockets.connected[activeGames[room].players[i].playerID].emit('startPanel', activeGames[room]);		
					}
				}
				// io.sockets.connected[activeGames[room].players[0].playerID].emit('startGuesser', activeGames[room]);
				// io.sockets.connected[activeGames[room].players[1].playerID].emit('startPanel', activeGames[room]);
				// io.sockets.connected[activeGames[room].players[2].playerID].emit('startPanel', activeGames[room]);
			}, 5000);
		}
	});

	// listen for response from service, stating that game was saved
	// start game
	// socket.on('startGame', function(gameInstance) {
	// 	console.log('starting game in gameInstance', gameInstance);
		
	// 	// send different messages to guesser and panel to start game
	// 	io.sockets.connected[gameInstance.players[0].playerID].emit('startGuesser', gameInstance.room);
	// 	io.sockets.connected[gameInstance.players[1].playerID].emit('startPanel', gameInstance.room);
	// 	io.sockets.connected[gameInstance.players[2].playerID].emit('startPanel', gameInstance.room);
	// });

	// listen for guesser sending initial question
	socket.on('guesserSentQuestion', function(question, botResponse, room) {
		console.log('question received in guesserSentQuestion', question);
		console.log('botResponse received in guesserSentQuestion', botResponse);
		console.log('room received in guesserSentQuestion', room);

		// store question
		activeGames[room].question = question;
		activeGames[room].answers.push({
			answer: botResponse,
			isBot: true
		});

		// see what activeGames looks like at this point
		console.log('activeGames[room] is', activeGames[room]);

		// send different messages to guesser and panel to start game
		for (var i = 0; i < activeGames[room].players.length; i++) {
			if (i === activeGames[room].currentGuesserIndex) {
				io.sockets.connected[activeGames[room].players[i].playerID].emit('guesserWait', activeGames[room]);		
			} else {
				io.sockets.connected[activeGames[room].players[i].playerID].emit('sendPanelQuestion', activeGames[room]);		
			}
		}
		
		// trigger panel to switch views and act
		// io.sockets.connected[activeGames[room].players[0].playerID].emit('guesserWait', activeGames[room]);
		// io.sockets.connected[activeGames[room].players[1].playerID].emit('sendPanelQuestion', activeGames[room]);
		// io.sockets.connected[activeGames[room].players[2].playerID].emit('sendPanelQuestion', activeGames[room]);
	});

	// // listen for all panel responses
	// socket.on('guesserChooseAnswer', function(gameInstance) {
	// 	console.log('all answers received in panelSendAnswers', gameInstance.answers);
	// });

	// listen for each panel member to send answer
	socket.on('panelSentAnswer', function(answer, room) {
		console.log('answer received in panelSentAnswer', answer);
		console.log('room received in panelSentAnswer', room);

		// store answer
		activeGames[room].answers.push({
			answer: answer,
			isBot: false
		});

		// see what activeGames looks like at this point
		console.log('activeGames[room] is', activeGames[room]);

		if (activeGames[room].answers.length === 3) {
			console.log('sending panel answers in five seconds!');

			// shuffle answers
			shuffle.knuthShuffle(activeGames[room].answers);
			
			setTimeout(function() {
				console.log('sending panel answers in ', activeGames[room]);
				
				// send to all players in the room
				io.in(room).emit('guesserChooseAnswer', activeGames[room]);
			}, 5000);
		}	
	});

	// listen for guesser choice
	socket.on('guesserChoseAnswer', function(answer, room) {
		console.log('player answer received in guesserChoseAnswer', answer);
		console.log('player room received in guesserChoseAnswer', room);

		// check if socket that triggered event is current player
		if (activeGames[room].players[activeGames[room].currentGuesserIndex].playerID === socket.id) {

			console.log('the guesser is the one that clicked');

			// assign guesser's choice to game instance
			activeGames[room].guesserChoice = answer.answer;

			// check if answer is correct
			activeGames[room].answers.forEach(function(panelAnswer) {
				console.log(panelAnswer, 'panelAnswer is something now in loop');
				if (panelAnswer.answer === activeGames[room].guesserChoice) {
					console.log('found the match answer');
					if (panelAnswer.isBot) {
						console.log('right');
						activeGames[room].gameResult = 'Player Guessed Correctly!';
					} else {
						console.log('wrong');
						activeGames[room].gameResult = 'Player Guessed Incorrectly!';
					}
				}
			});

			console.log('sending game results in five seconds!');
			setTimeout(function() {
				console.log('sending game results in ', activeGames[room]);
				
				// send to all players in the room
				io.in(room).emit('displayResults', activeGames[room]);
			}, 5000);
		} else {
			console.log('the guesser is NOTTTTTT the one that clicked');
		}
	});

	socket.on('gameNextTurn', function(room) {
		if (activeGames[room].players[activeGames[room].currentGuesserIndex].playerID === socket.id) {

		console.log('the guesser is the one that clicked');
		
			// update currentGuesserIndex to move to next player
			activeGames[room].currentGuesserIndex++;

			// check to see if game is over
			if (activeGames[room].currentGuesserIndex >= activeGames[room].players.length) {
				// delete game
				delete activeGames[room];

				console.log('double check game is deleted', activeGames);

				// emit gameOver event, taking all users back to create/join page
				io.in(room).emit('gameOver');
			} else {

				console.log('starting new round in room', room);
				// if game is not over, continue to next round
				// reset question, answers, and gameResult
				activeGames[room].question = '';
				activeGames[room].answers = [];
				activeGames[room].guesserChoice = '';
				activeGames[room].gameResult = '';

				if (activeGames[room].players.length === 3) {
					console.log('starting new game in five seconds!');
					setTimeout(function() {
						console.log('starting game in gameInstance', activeGames[room]);
						
						// send different messages to guesser and panel to start game
						for (var i = 0; i < activeGames[room].players.length; i++) {
							if (i === activeGames[room].currentGuesserIndex) {
								io.sockets.connected[activeGames[room].players[i].playerID].emit('startGuesser', activeGames[room]);		
							} else {
								io.sockets.connected[activeGames[room].players[i].playerID].emit('startPanel', activeGames[room]);		
							}
						}
						// io.sockets.connected[activeGames[room].players[0].playerID].emit('startGuesser', activeGames[room]);
						// io.sockets.connected[activeGames[room].players[1].playerID].emit('startPanel', activeGames[room]);
						// io.sockets.connected[activeGames[room].players[2].playerID].emit('startPanel', activeGames[room]);
					}, 5000);
				}
			}
		} else {
			console.log('the guesser is NOTTTTTT the one that clicked');
		}
	});
});

exports = module.exports = app;
		// var newG = new $storage()
		// newG.newGame()
		// Collection.set(newG)
