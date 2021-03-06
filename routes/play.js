/*jslint node: true */
"use strict";
module.exports = function(io) {

    //Init common resources
    var _ = require('lodash');
    var express = require('express');
    var playSpace = io.of('/play');
    var router = express.Router();

    var Game = require("../models/game").game;

   const esEnvido = {
    'envido': true,
    'envido2' : true,
    'realenvido': true,
    'faltaenvido': true
    };



    //Epxress middleware
    function mustBeLogged(req, res, next) {
        if (!req.user) {
            return res.redirect('/login');
        }
        next();
    }

    function parseGame(req, res, next) {
        var gameId = req.query.gameId;
        Game.load(gameId, function(err, game) {
            if (err) next(err);
            var p, board, player,score,envidoPoints;
            if (req.user._id.toString() === game.player2.user.toString()) {
                p = game.player2;
                player = "player2";
                board = [game.currentRound.board[1], game.currentRound.board[0]];
                score = [game.score[1],game.score[0]];
                envidoPoints = game.player2.envidoPoints;

            } else {
                player = "player1";
                p = game.player1;
                board = game.currentRound.board;
                score = game.score;
                envidoPoints = game.player1.envidoPoints;
            }
            var objectGame = {
                game: game,
                board: board,
                turn : game.currentRound.currentTurn,
                cartas: p.cards,
                nickname: p.nickname,
                player: player,
                user: req.user,
                score: score,
                plays: game.currentRound.fsm.transitions()
            };
            req.game = objectGame;
            next();
        });
    }



    //Functions


    /**
     * Aplicar la funcion f en el juego cargado con el id pasado
     * en el callback se retorna el juego guardado y el resutlado de la funcion
     * @param  {[objectId]}   id [id del juego a cargar]
     * @param  {[function]}   f  [function que toma como parametro un]
     * @param  {Function} cb [callback de los resultados]
     */
    function apply(id,f,cb){
        Game.load(id, function(err,game) {
            if (err)
                return cb(err);
            var res;
            try {
                res = f(game);
                game.save(function(err, game) {
                    if (err) {
                        return cb(err);
                    }
                    return cb(err, game, res);
                });
            }
            catch(e) {
                return cb(e,game,res);
            }
        });
    }

    function jugadas(game) {
        var plays = game.currentRound.fsm.transitions();
        return _.filter(plays,function (p) {
            return p != "playCard";
        });
    }

    function ganadorEnvido(game) {
        var player;
        var res = game.player1.envidoPoints - game.player2.envidoPoints;
        switch (true) {
            case (res > 0): //Gano player1
                player = "player1";
                break;
            case (res < 0): //Gano player2
                player = "player2";
                break;
            case (res = 0): //Empate, gana la mano
                player = game.currentHand == "player1"?"player1":"player2";
                break;
        }
        return player;
    }


    //Router middle ware setup
    router.use(mustBeLogged);



    //Socket connection handler
    playSpace.on('connection', function(socket) {

        //Common resources
        var currentPlayer = socket.handshake.query.player;
        var gameId = socket.handshake.query.gameId;
        var playroom = 'play-' + gameId;

        function statusControl(game,data) {
            switch (game.status) {
                case game.const.NEWROUND:
                    //Que hacer cuando hay una nueva ronda
                    var proximo = game[game.currentHand].nickname;
                    playSpace.to(playroom).emit("nuevaRonda",{hands: [game.player1.cards,game.player2.cards],nextPlayer: proximo});
                    break;
                case game.const.ENDED:
                    //Cuando termino el juego
                    playSpace.to(playroom).emit('endGame',{player:data.maybePlayer});
                    break;
                case game.const.ABORTED:
                    //Se aborto el juego, el juego se aborta con game.abort()
                    break;
                case game.const.PLAYING:
                    //Se esta jugando
                    break;
                default:
                    //Otro
                    console.log("Estado del juego: ",game.status);
            }
        }

        function errorControl(err) {
            switch (err.name) {
                case 'gameAborted':
                    //Handler para decirle que el juego esta cancelado
                    break;
                case 'invalidMove':
                    //Handler para decirle que al cliente que realizo una movida invalida
                    //playSpace.to(socket.id).emit('invalidMove'); //Del lado del cliente podria tirar un alert
                    break;
                case 'invalidTurn':
                    playSpace.to(socket.id).emit('invalidTurn');
                    break;
                case 'gameEnded':
                    playSpace.to(socket.id).emit('gameEnded');
                    break;
                default:
                    console.error(err);
            }
        }

        //Socket setup
        socket.join(playroom);


        //Events


        //Evento de carta jugada
        socket.on('playCard', function(data) {
            //Que hace con el game y que retorna?
            function playCardHandler(game){
                let cardIndex = data.index;
                let player = data.player;
                var carta = game[player].cards[cardIndex];
                var maybePlayer = game.play(player,'playCard',game[player].cards[cardIndex]);
                return {carta:carta,maybePlayer:maybePlayer};
            }

            apply(gameId,playCardHandler,function (err,game,res) {
                if (err) {
                    errorControl(err);
                }
                else {
                    playSpace.to(playroom).emit('cartaJugada',{index:data.index,carta:res.carta,player: data.player});
                    statusControl(game,{maybePlayer : res.maybePlayer});
                    playSpace.to(playroom).emit('changeTurn',{score:game.score,turn:game.currentRound.currentTurn,plays:jugadas(game)});
                }

            });
        });


        //Evento de cantar jugada
        socket.on('jugada',function(data) {


            function playHandler(game) {
                let player = data.player;
                let play = data.play;
                var puntos,ganador;
                if (play == 'quiero' && esEnvido[game.status]) {
                    puntos= [game.player1.envidoPoints,game.player2.envidoPoints];
                    ganador = ganadorEnvido(game);
                }
                var maybePlayer = (game.play(player,play));
                return {maybePlayer:maybePlayer,envido:{ puntos:puntos, ganador: ganador}};
            }

            apply(gameId,playHandler,function (err,game,res) {
                if (err) {
                    errorControl(err);
                } else {
                //Enviar mensaje a todos los de la room excepto al que lo envia
                    statusControl(game,{maybePlayer:res.maybePlayer});
                    if(res.envido.ganador) {
                        playSpace.to(playroom).emit('envido',{puntos:res.envido.puntos,ganador:res.envido.ganador});
                    }
                    playSpace.to(playroom).emit('changeTurn',{score:game.score,turn:game.currentRound.currentTurn,plays:jugadas(game)});
                    socket.broadcast.to(playroom).emit('cantaron',{jugada:data.play,player:data.player});
                }
            });
        });


        //Disconnect handler
        socket.on('disconenct', function() {
            socket.leave(playroom);
        });
    });



    //Router verbs

    router.get('/', parseGame, function(req, res) {
        res.render('play', {
            game: req.game
        });
    });

    return router;
};
