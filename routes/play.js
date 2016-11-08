/*TODO:
    + query the game id
    + Load it with Game.load(gameId,callback)
    + Identify the current user with the player in the game
    + Parse the needed data to render the view (current player cards, current turn, board, points, etc)
    + Render the view
*/
module.exports = function (io){
var express = require('express');
var passport = require('passport');
var playSpace = io.of('/play');
var User = require('../models/user');
var router = express.Router();

var Game = require("../models/game").game;
var Player = require("../models/player").player;

function mustBeLogged(req,res,next) {
    if(!req.user) return res.redirect('/login');
    next();
}



function playAndSave (id,player,move,cardIndex,cb) {

    var id=arguments[0],player=arguments[1],move=arguments[2],cardIndex,cb;
    if (arguments.length == 5) {
        cardIndex = arguments[3];
        cb = arguments[4];
    }
    else {
        cb = arguments[3];
    };
    Game.load(id,function (err,game){
        if (err) {
            return cb(err,null);
        }
        try {
            game.play(player,move,game[player].cards[cardIndex]);
            game.save(function (err,game) {
                if (err) {
                    return cb(err,null);
                }
                console.log("intenta guardar");
                return cb(err,game);
            })
        }
        catch(e) {
            return cb(e,null);
        }

    })

}

function parseGame(req,res,next){
    gameId = req.query.gameId;
    Game.load(gameId,function (err,game) {
        if (err) next(err);
        var p,board,player;
        if (req.user._id.toString() === game.player2.user.toString()) {
            p = game.player2;
            player = "player2";
            board = [game.currentRound.board[1],game.currentRound.board[0]];
        }
        else {
            player = "player1";
            p = game.player1;
            board = game.currentRound.board;
        }
        var objectGame = {
            game:game,
            board:board,
            cartas:p.cards,
            nickname:p.nickname,
            player: player,
            user:req.user,
            score:game.score,
            plays:game.currentRound.fsm.transitions()
        }
        req.game = objectGame;
        next();
    })
}

router.use(mustBeLogged);

//Manejar los sockets conectados al namespace /play
playSpace.on('connection',function(socket) {

    //Meter usuario en la room del juego
    var gameId = socket.handshake.query.gameId;
    var playroom = 'play-'+gameId;
    socket.join(playroom);
    socket.on('cardClicked',function (data) {
        //console.log("se clickeo la carta ",data);
    })

    socket.on('playCard',function (data) {
        playAndSave(gameId,data.player,'playCard',data.index, function(err,game) {
            if (err) {
                console.log("Error en play ",err)
                switch (err.name) {
                    case 'gameAborted':
                        //Handler para decirle que el juego esta cancelado
                        break;
                    case 'invalidMove':
                        //Handler para decirle que al cliente que realizo una movida invalida
                        playSpace.to(socket.id).emit('invalidMove'); //Del lado del cliente podria tirar un alert
                        break;
                    case 'invalidTurn':
                        playSpace.to(socket.id).emit('invalidTurn');
                        break;
                    default:
                        console.log(err);
                }
            } else {
                console.log("OK");
                console.log(game.player1.cards);
                //playSpace.to(playroom).emit('updateBoard',game);
            }
        })
    })


    socket.on('disconenct', function(){
        //abandonar la sala, y abortar el juego
        Game.lo
        socket.leave(playroom);
    });
})



router.get('/',parseGame, function(req,res,next) {
    //console.log(req.game.cartas,">>>>>>>>>>>>>>>>>>>>>>>>>><<<<<<<<<<<<<<<<<<<<<<<<<");
    res.render('play',{game:req.game})
})

    return router;
};
