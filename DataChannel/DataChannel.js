// Muaz Khan     - www.MuazKhan.com
// MIT License   - www.WebRTC-Experiment.com/licence
// Documentation - github.com/muaz-khan/WebRTC-Experiment/tree/master/DataChannel

// ______________
// DataChannel.js

(function () {
    window.DataChannel = function (channel, extras) {
        if (channel) this.automatic = true;

        this.channel = channel || location.href.replace(/\/|:|#|%|\.|\[|\]/g, '');

        extras = extras || {};

        var self = this,
            dataConnector, fileReceiver, textReceiver;

        this.onmessage = function (message, userid) {
            console.debug(userid, 'sent message:', message);
        };

        this.channels = {};
        this.onopen = function (userid) {
            console.debug(userid, 'is connected with you.');
        };

        this.onclose = function (event) {
            console.error('data channel closed:', event);
        };

        this.onerror = function (event) {
            console.error('data channel error:', event);
        };

        // by default; received file will be auto-saved to disk
        this.autoSaveToDisk = true;
        
        this.onFileReceived = function (fileName, file) {
            console.debug(file.name, file.size, file.type, 'received successfully.');
        };

        this.onFileSent = function (file) {
            console.debug(file.name, file.size, file.type, 'sent successfully.');
        };

        this.onFileProgress = function (chunk) {
            console.debug('current position:', chunk.currentPosition, ' and ', chunk.maxChunks, 'max chunks.');
        };

        function prepareInit(callback) {
            for (var extra in extras) {
                self[extra] = extras[extra];
            }
            self.direction = self.direction || 'many-to-many';
            if (self.userid) window.userid = self.userid;

            if (!self.openSignalingChannel) {
                if (!self.automatic) {
                    // https://github.com/muaz-khan/WebRTC-Experiment/blob/master/socketio-over-nodejs
                    // https://github.com/muaz-khan/WebRTC-Experiment/blob/master/websocket-over-nodejs
                    self.openSignalingChannel = function (config) {
                        config.channel = config.channel || self.channel || location.hash.substr(1);
                        var websocket = new WebSocket('wss://www.webrtc-experiment.com:8563');
                        websocket.channel = config.channel;
                        websocket.onopen = function () {
                            websocket.push(JSON.stringify({
                                open: true,
                                channel: config.channel
                            }));
                            if (config.callback) config.callback(websocket);
                        };

                        websocket.onmessage = function (event) {
                            config.onmessage(JSON.parse(event.data));
                        };
                        websocket.push = websocket.send;
                        websocket.send = function (data) {
                            if (websocket.readyState != 1)
                                return setTimeout(function () {
                                    websocket.send(data);
                                }, 500);

                            websocket.push(JSON.stringify({
                                data: data,
                                channel: config.channel
                            }));
                        };
                    };

                    callback();
                } else {
                    if (typeof self.transmitRoomOnce == 'undefined') self.transmitRoomOnce = true;

                    self.openSignalingChannel = function (config) {
                        config = config || {};

                        channel = config.channel || self.channel || 'default-channel';
                        var socket = new window.Firebase('https://' + (self.firebase || 'chat') + '.firebaseIO.com/' + channel);
                        socket.channel = channel;

                        socket.on('child_added', function (data) {
                            config.onmessage(data.val());
                        });

                        socket.send = function (data) {
                            this.push(data);
                        };

                        if (!self.socket) self.socket = socket;
                        if (channel != self.channel || (self.isInitiator && channel == self.channel))
                            socket.onDisconnect().remove();

                        if (config.onopen) setTimeout(config.onopen, 1);

                        return socket;
                    };

                    if (!window.Firebase) {
                        var script = document.createElement('script');
                        script.src = 'https://cdn.firebase.com/v0/firebase.js';
                        script.onload = callback;
                        document.documentElement.appendChild(script);
                    } else callback();
                }
            } else callback();
        }

        function init() {
            if (self.config) return;

            self.config = {
                ondatachannel: function (room) {
                    if (!dataConnector) {
                        self.room = room;
                        return;
                    }

                    var tempRoom = {
                        id: room.roomToken,
                        owner: room.broadcaster
                    };

                    if (self.ondatachannel) return self.ondatachannel(tempRoom);

                    if (self.joinedARoom) return;
                    self.joinedARoom = true;

                    self.join(tempRoom);
                },
                onopen: function (userid, _channel) {
                    self.onopen(userid, _channel);
                    self.channels[userid] = {
                        channel: _channel,
                        send: function (data) {
                            self.send(data, this.channel);
                        }
                    };

                    // fetch files from file-queue
                    for (var q in self.fileQueue) {
                        self.send(self.fileQueue[q], channel);
                    }
                },
                onmessage: function (data, userid) {
                    data = JSON.parse(data);

                    if (!IsDataChannelSupported) {
                        if (data.userid === window.userid) return;
                        data = data.message;
                    }

                    if (data.type === 'text')
                        textReceiver.receive(data, self.onmessage, userid);

                    else if (data.maxChunks)
                        fileReceiver.receive(data);

                    else self.onmessage(data, userid);
                },
                onclose: function (event) {
                    var myChannels = self.channels,
                        closedChannel = event.currentTarget;

                    for (var userid in myChannels) {
                        if (closedChannel === myChannels[userid].channel) {
                            delete myChannels[userid];
                        }
                    }

                    self.onclose(event);
                }
            };

            dataConnector = IsDataChannelSupported ?
                new DataConnector(self, self.config) :
                new SocketConnector(self.channel, self.config);

            fileReceiver = new FileReceiver(self);
            textReceiver = new TextReceiver();

            if (self.room) self.config.ondatachannel(self.room);
        }

        this.open = function (_channel) {
            self.joinedARoom = true;

            if (self.socket) self.socket.onDisconnect().remove();
            else self.isInitiator = true;

            if (_channel) self.channel = _channel;

            prepareInit(function () {
                init();
                dataConnector.createRoom();
            });
        };

        this.connect = function (_channel) {
            if (_channel) self.channel = _channel;
            if (IsDataChannelSupported) prepareInit(init);
        };

        // manually join a room
        this.join = function (room) {
            if (!room.id || !room.owner) {
                throw 'Invalid room info passed.';
            }

            dataConnector.joinRoom({
                roomToken: room.id,
                joinUser: room.owner
            });
        };

        this.fileQueue = {};

        this.send = function (data, _channel) {
            if (!data)
                throw 'No file, data or text message to share.';

            if (!!data.forEach) {
                for (var i = 0; i < data.length; i++) {
                    self.send(data[i], _channel);
                }
                return;
            }

            if (data.size)
                FileSender.send({
                    file: data,
                    channel: dataConnector,
                    root: self,
                    _channel: _channel
                });
            else
                TextSender.send({
                    text: data,
                    channel: dataConnector,
                    _channel: _channel
                });
        };

        this.onleave = function (userid) {
            console.debug(userid, 'left!');
        };

        this.leave = this.eject = function (userid) {
            dataConnector.leave(userid, self.autoCloseEntireSession);
        };

        this.openNewSession = function (isOpenNewSession, isNonFirebaseClient) {
            if (isOpenNewSession) {
                if (self.isNewSessionOpened) return;
                self.isNewSessionOpened = true;

                if (!self.joinedARoom) self.open();
            }

            if (!isOpenNewSession || isNonFirebaseClient) self.connect();

            // for non-firebase clients
            if (isNonFirebaseClient)
                setTimeout(function () {
                    self.openNewSession(true);
                }, 5000);
        };

        if (self.automatic) {
            if (window.Firebase) {
                console.debug('checking presence of the room..');
                new window.Firebase('https://' + (extras.firebase || self.firebase || 'chat') + '.firebaseIO.com/' + self.channel).once('value', function (data) {
                    console.debug('room is present?', data.val() != null);
                    self.openNewSession(data.val() == null);
                });
            } else self.openNewSession(false, true);
        }
    };

    function DataConnector(root, config) {
        var self = {};
        var that = this;

        self.userToken = root.userid = root.userid || uniqueToken();
        self.sockets = [];
        self.socketObjects = {};

        var channels = '--',
            isbroadcaster, isGetNewRoom = true,
            RTCDataChannels = {};

        function newPrivateSocket(_config) {
            var socketConfig = {
                channel: _config.channel,
                onmessage: socketResponse,
                onopen: function () {
                    if (isofferer && !peer) initPeer();

                    _config.socketIndex = socket.index = self.sockets.length;
                    self.socketObjects[socketConfig.channel] = socket;
                    self.sockets[_config.socketIndex] = socket;
                }
            };

            socketConfig.callback = function (_socket) {
                socket = _socket;
                socketConfig.onopen();
            };

            var socket = root.openSignalingChannel(socketConfig),
                isofferer = _config.isofferer,
                gotstream, inner = {}, peer;

            var peerConfig = {
                onICE: function (candidate) {
                    socket && socket.send({
                        userToken: self.userToken,
                        candidate: {
                            sdpMLineIndex: candidate.sdpMLineIndex,
                            candidate: JSON.stringify(candidate.candidate)
                        }
                    });
                },
                onopen: onChannelOpened,
                onmessage: function (data) {
                    config.onmessage(data, _config.userid);
                },
                onclose: config.onclose,
                onerror: root.onerror
            };

            function initPeer(offerSDP) {
                if (root.direction === 'one-to-one' && window.isFirstConnectionOpened) return;

                if (!offerSDP) peerConfig.onOfferSDP = sendsdp;
                else {
                    peerConfig.offerSDP = offerSDP;
                    peerConfig.onAnswerSDP = sendsdp;
                }

                peer = RTCPeerConnection(peerConfig);
            }

            function onChannelOpened(channel) {
                channel.peer = peer.peer;
                RTCDataChannels[_config.channel] = channel;

                config.onopen(_config.userid, channel);

                if (root.direction === 'many-to-many' && isbroadcaster && channels.split('--').length > 3) {
                    defaultSocket && defaultSocket.send({
                        newParticipant: socket.channel,
                        userToken: self.userToken
                    });
                }

                window.isFirstConnectionOpened = gotstream = true;
            }

            function sendsdp(sdp) {
                sdp = JSON.stringify(sdp);

                socket.send({
                    userToken: self.userToken,
                    sdp: sdp
                });
            }

            function socketResponse(response) {
                if (response.userToken == self.userToken) return;

                if (response.sdp) {
                    _config.userid = response.userToken;
                    selfInvoker(response.sdp);
                }

                if (response.candidate && !gotstream) {
                    peer && peer.addICE({
                        sdpMLineIndex: response.candidate.sdpMLineIndex,
                        candidate: JSON.parse(response.candidate.candidate)
                    });

                    console.debug('ice candidate', response.candidate.candidate);
                }

                if (response.left) {
                    if (peer && peer.peer) {
                        peer.peer.close();
                        peer.peer = null;
                    }

                    if (response.closeEntireSession) leaveChannels();
                    else if (socket) {
                        socket.send({
                            left: true,
                            userToken: self.userToken
                        });
                        socket = null;
                    }

                    root.onleave(response.userToken);
                }

                if (response.playRoleOfBroadcaster)
                    setTimeout(function () {
                        self.roomToken = response.roomToken;
                        root.open(self.roomToken);
                        self.sockets = swap(self.sockets);
                    }, 600);
            }

            var invokedOnce = false;

            function selfInvoker(sdp) {
                if (invokedOnce) return;

                invokedOnce = true;
                inner.sdp = JSON.parse(sdp);

                if (isofferer) peer.addAnswerSDP(inner.sdp);
                else initPeer(inner.sdp);

                console.debug('sdp', inner.sdp.sdp);
            }
        }

        function onNewParticipant(channel) {
            if (!channel || channels.indexOf(channel) != -1 || channel == self.userToken) return;
            channels += channel + '--';

            var new_channel = uniqueToken();

            newPrivateSocket({
                channel: new_channel,
                closeSocket: true
            });

            defaultSocket.send({
                participant: true,
                userToken: self.userToken,
                joinUser: channel,
                channel: new_channel
            });
        }

        function uniqueToken() {
            return Math.round(Math.random() * 60535) + 5000000;
        }

        function leaveChannels(channel) {
            var alert = {
                left: true,
                userToken: self.userToken
            };

            // if room initiator is leaving the room; close the entire session
            if (isbroadcaster) {
                if (root.autoCloseEntireSession) alert.closeEntireSession = true;
                else
                    self.sockets[0].send({
                        playRoleOfBroadcaster: true,
                        userToken: self.userToken,
                        roomToken: self.roomToken
                    });
            }

            if (!channel) {
                // closing all sockets
                var sockets = self.sockets,
                    length = sockets.length;

                for (var i = 0; i < length; i++) {
                    var socket = sockets[i];
                    if (socket) {
                        socket.send(alert);

                        if (self.socketObjects[socket.channel])
                            delete self.socketObjects[socket.channel];

                        delete sockets[i];
                    }
                }

                that.left = true;
            }

            // eject a specific user!
            if (channel) {
                socket = self.socketObjects[channel];
                if (socket) {
                    socket.send(alert);

                    if (self.sockets[socket.index])
                        delete self.sockets[socket.index];

                    delete self.socketObjects[channel];
                }
            }
            self.sockets = swap(self.sockets);
        }

        window.onbeforeunload = function () {
            leaveChannels();
        };

        window.onkeyup = function (e) {
            if (e.keyCode == 116) leaveChannels();
        };

        var defaultSocket = root.openSignalingChannel({
            onmessage: function (response) {
                if (response.userToken == self.userToken) return;

                if (isGetNewRoom && response.roomToken && response.broadcaster) config.ondatachannel(response);

                if (response.newParticipant) onNewParticipant(response.newParticipant);

                if (response.userToken && response.joinUser == self.userToken && response.participant && channels.indexOf(response.userToken) == -1) {
                    channels += response.userToken + '--';

                    console.debug('Data connection is being opened between you and', response.userToken || response.channel);
                    newPrivateSocket({
                        isofferer: true,
                        channel: response.channel || response.userToken,
                        closeSocket: true
                    });
                }
            },
            callback: function (socket) {
                defaultSocket = socket;
            }
        });

        return {
            createRoom: function () {
                self.roomToken = uniqueToken();

                isbroadcaster = true;
                isGetNewRoom = false;

                (function transmit() {
                    defaultSocket && defaultSocket.send({
                        roomToken: self.roomToken,
                        broadcaster: self.userToken
                    });

                    if (!root.transmitRoomOnce && !that.leaving) {
                        if (root.direction === 'one-to-one') {
                            if (!window.isFirstConnectionOpened) setTimeout(transmit, 3000);
                        } else setTimeout(transmit, 3000);
                    }
                })();
            },
            joinRoom: function (_config) {
                self.roomToken = _config.roomToken;
                isGetNewRoom = false;

                newPrivateSocket({
                    channel: self.userToken
                });

                defaultSocket.send({
                    participant: true,
                    userToken: self.userToken,
                    joinUser: _config.joinUser
                });
            },
            send: function (message, _channel) {
                var data = JSON.stringify(message);

                if (_channel)
                    _channel.send(data);
                else
                    for (var channel in RTCDataChannels) {
                        RTCDataChannels[channel].send(data);
                    }
            },
            leave: function (userid, autoCloseEntireSession) {
                if (autoCloseEntireSession) root.autoCloseEntireSession = true;
                leaveChannels(userid);
                if (!userid) {
                    self.joinedARoom = isbroadcaster = false;
                    isGetNewRoom = true;
                }
            }
        };
    }

    function SocketConnector(_channel, config) {
        var channel = config.openSocket({
            channel: _channel,
            onopen: config.onopen,
            onmessage: config.onmessage
        });

        return {
            send: function (message) {
                channel && channel.send({
                    userid: userid,
                    message: JSON.stringify(message)
                });
            }
        };
    }

    function getRandomString() {
        return (Math.random() * new Date().getTime()).toString(36).toUpperCase().replace(/\./g, '-');
    }

    window.userid = getRandomString();

    // _______
    // File.js

    var File = {
        Send: function (config) {
            var file = config.file;
            var socket = config.channel;

            var chunkSize = 40 * 1000; // 64k max sctp limit (AFAIK!)
            var sliceId = 0;
            var cacheSize = chunkSize;

            var chunksPerSlice = Math.floor(Math.min(100000000, cacheSize) / chunkSize);
            var sliceSize = chunksPerSlice * chunkSize;
            var maxChunks = Math.ceil(file.size / chunkSize);

            // uuid is used to uniquely identify sending instance
            var uuid = (Math.random() * new Date().getTime()).toString(36).toUpperCase().replace(/\./g, '-');

            socket.send({
                uuid: uuid,
                maxChunks: maxChunks,
                size: file.size,
                name: file.name,
                lastModifiedDate: file.lastModifiedDate,
                type: file.type,
                start: true
            }, config.extra);

            file.maxChunks = maxChunks;
            file.uuid = uuid;
            if (config.onBegin) config.onBegin(file);

            var blob, reader = new FileReader();
            reader.onloadend = function (evt) {
                if (evt.target.readyState == FileReader.DONE) {
                    addChunks(file.name, evt.target.result, function () {
                        sliceId++;
                        if ((sliceId + 1) * sliceSize < file.size) {
                            blob = file.slice(sliceId * sliceSize, (sliceId + 1) * sliceSize);
                            reader.readAsArrayBuffer(blob);
                        } else if (sliceId * sliceSize < file.size) {
                            blob = file.slice(sliceId * sliceSize, file.size);
                            reader.readAsArrayBuffer(blob);
                        } else {
                            socket.send({
                                uuid: uuid,
                                maxChunks: maxChunks,
                                size: file.size,
                                name: file.name,
                                lastModifiedDate: file.lastModifiedDate,
                                type: file.type,
                                end: true
                            }, config.extra);

                            file.url = URL.createObjectURL(file);
                            if (config.onEnd) config.onEnd(file);
                        }
                    });
                }
            };

            blob = file.slice(sliceId * sliceSize, (sliceId + 1) * sliceSize);
            reader.readAsArrayBuffer(blob);

            var numOfChunksInSlice;
            var currentPosition = 0;
            var hasEntireFile;
            var chunks = [];

            function addChunks(fileName, binarySlice, callback) {
                numOfChunksInSlice = Math.ceil(binarySlice.byteLength / chunkSize);
                for (var i = 0; i < numOfChunksInSlice; i++) {
                    var start = i * chunkSize;
                    chunks[currentPosition] = binarySlice.slice(start, Math.min(start + chunkSize, binarySlice.byteLength));

                    FileConverter.ArrayBufferToDataURL(chunks[currentPosition], function (str) {
                        socket.send({
                            uuid: uuid,
                            value: str,
                            currentPosition: currentPosition,
                            maxChunks: maxChunks
                        }, config.extra);
                    });

                    currentPosition++;
                }

                if (config.onProgress) {
                    config.onProgress({
                        currentPosition: currentPosition,
                        maxChunks: maxChunks,
                        uuid: uuid
                    });
                }

                if (currentPosition == maxChunks) {
                    hasEntireFile = true;
                }

                if (config.interval == 0 || typeof config.interval == 'undefined')
                    callback();
                else
                    setTimeout(callback, config.interval);
            }
        },

        Receiver: function (config) {
            var packets = {};

            function merge(mergein, mergeto) {
                for (var item in mergeto) {
                    if (!mergein[item])
                        mergein[item] = mergeto[item];
                }
                return mergein;
            }

            function receive(chunk) {
                if (chunk.start && !packets[chunk.uuid]) {
                    packets[chunk.uuid] = [];
                    if (config.onBegin) config.onBegin(chunk);
                }

                if (!chunk.end && chunk.value) packets[chunk.uuid].push(chunk.value);

                if (chunk.end) {
                    var _packets = packets[chunk.uuid];
                    var finalArray = [], length = _packets.length;

                    for (var i = 0; i < length; i++) {
                        if (!!_packets[i]) {
                            FileConverter.DataURLToBlob(_packets[i], function (buffer) {
                                finalArray.push(buffer);
                            });
                        }
                    }

                    var blob = new Blob(finalArray, { type: chunk.type });
                    blob = merge(blob, chunk);
                    blob.url = URL.createObjectURL(blob);
                    blob.uuid = chunk.uuid;

                    if (!blob.size) console.error('Something went wrong. Blob Size is 0.');

                    if (config.onEnd) config.onEnd(blob);
                }

                if (config.onProgress) config.onProgress(chunk);
            }

            return {
                receive: receive
            };
        },
        SaveToDisk: function (fileUrl, fileName) {
            var hyperlink = document.createElement('a');
            hyperlink.href = fileUrl;
            hyperlink.target = '_blank';
            hyperlink.download = fileName || fileUrl;

            var mouseEvent = new MouseEvent('click', {
                view: window,
                bubbles: true,
                cancelable: true
            });

            hyperlink.dispatchEvent(mouseEvent);
            (window.URL || window.webkitURL).revokeObjectURL(hyperlink.href);
        }
    };

    // ________________
    // FileConverter.js
    var FileConverter = {
        ArrayBufferToDataURL: function (buffer, callback) {
            window.BlobBuilder = window.MozBlobBuilder || window.WebKitBlobBuilder || window.BlobBuilder;

            // getting blob from array-buffer
            var blob = new Blob([buffer]);

            // reading file as binary-string
            var fileReader = new FileReader();
            fileReader.onload = function (e) {
                callback(e.target.result);
            };
            fileReader.readAsDataURL(blob);
        },
        DataURLToBlob: function (dataURL, callback) {
            var binary = atob(dataURL.substr(dataURL.indexOf(',') + 1)),
                i = binary.length,
                view = new Uint8Array(i);

            while (i--) {
                view[i] = binary.charCodeAt(i);
            }

            callback(new Blob([view]));
        }
    };

    // _____________
    // FileSender.js
    var FileSender = {
        send: function (config) {
            var root = config.root;
            var interval = 100;

            // using File.js to send files
            File.Send({
                channel: config.channel,
                extra: config._channel,
                file: config.file,
                interval: interval,
                onProgress: function (file) {
                    if (root.onFileProgress) {
                        root.onFileProgress({
                            // old one; for backward compatibility
                            remaining: file.maxChunks - file.currentPosition,
                            length: file.maxChunks,
                            sent: file.currentPosition,

                            // NEW properties
                            maxChunks: file.maxChunks,
                            currentPosition: file.currentPosition,
                            uuid: file.uuid
                        }, file.uuid);
                    }
                },
                onBegin: root.onFileStart,
                onEnd: function (file) {
                    if (root.onFileSent) {
                        root.onFileSent(file, file.uuid);
                    }

                    if (!root.fileQueue[file.name])
                        root.fileQueue[file.name] = file;
                }
            });
        }
    };

    // _______________
    // FileReceiver.js

    function FileReceiver(root) {
        var receiver = new File.Receiver({
            onProgress: function (file) {
                if (root.onFileProgress) {
                    root.onFileProgress({
                        // old one; for backward compatibility
                        remaining: file.maxChunks - file.currentPosition,
                        length: file.maxChunks,
                        received: file.currentPosition,

                        // NEW properties
                        maxChunks: file.maxChunks,
                        currentPosition: file.currentPosition,
                        uuid: file.uuid
                    }, file.uuid);
                }
            },
            onBegin: root.onFileStart,
            onEnd: function (file) {
                if (root.autoSaveToDisk) {
                    File.SaveToDisk(file.dataURL, file.name);
                }

                if (root.onFileReceived) {
                    root.onFileReceived(file.name, file);
                }
            }
        });

        return {
            receive: function (data) {
                receiver.receive(data);
            }
        };
    }

    var TextSender = {
        send: function (config) {
            var channel = config.channel,
                _channel = config._channel,
                initialText = config.text,
                packetSize = 1000 /* chars */,
                textToTransfer = '',
                isobject = false;

            if (typeof initialText !== 'string') {
                isobject = true;
                initialText = JSON.stringify(initialText);
            }

            // uuid is used to uniquely identify sending instance
            var uuid = getRandomString();
            var sendingTime = new Date().getTime();

            sendText(initialText);

            function sendText(textMessage, text) {
                var data = {
                    type: 'text',
                    uuid: uuid,
                    sendingTime: sendingTime
                };

                if (textMessage) {
                    text = textMessage;
                    data.packets = parseInt(text.length / packetSize);
                }

                if (text.length > packetSize)
                    data.message = text.slice(0, packetSize);
                else {
                    data.message = text;
                    data.last = true;
                    data.isobject = isobject;
                }

                channel.send(data, _channel);

                textToTransfer = text.slice(data.message.length);

                if (textToTransfer.length) {
                    setTimeout(function () {
                        sendText(null, textToTransfer);
                    }, 100);
                }
            }
        }
    };

    function TextReceiver() {
        var content = {};

        function receive(data, onmessage, userid) {
            // uuid is used to uniquely identify sending instance
            var uuid = data.uuid;
            if (!content[uuid]) content[uuid] = [];

            content[uuid].push(data.message);
            if (data.last) {
                var message = content[uuid].join('');
                if (data.isobject) message = JSON.parse(message);

                // bug: latency detection must be fixed
                // https://github.com/muaz-khan/WebRTC-Experiment/issues/63#issuecomment-21083575
                var receivingTime = new Date().getTime();
                var latency = Math.abs(receivingTime - data.sendingTime);

                if (onmessage) onmessage(message, userid, latency);

                delete content[uuid];
            }
        }

        return {
            receive: receive
        };
    }

    function swap(arr) {
        var swapped = [],
            length = arr.length;
        for (var i = 0; i < length; i++)
            if (arr[i]) swapped.push(arr[i]);
        return swapped;
    }

    window.moz = !!navigator.mozGetUserMedia;
    window.IsDataChannelSupported = !((moz && !navigator.mozGetUserMedia) || (!moz && !navigator.webkitGetUserMedia));

    function RTCPeerConnection(options) {
        var w = window,
            PeerConnection = w.mozRTCPeerConnection || w.webkitRTCPeerConnection,
            SessionDescription = w.mozRTCSessionDescription || w.RTCSessionDescription,
            IceCandidate = w.mozRTCIceCandidate || w.RTCIceCandidate;

        // protocol: 'text/chat', preset: true, stream: 16
        var dataChannelDict = {};

        var STUN = {
            url: !moz ? 'stun:stun.l.google.com:19302' : 'stun:23.21.150.121'
        };

        var TURN = {
            url: 'turn:homeo@turn.bistri.com:80',
            credential: 'homeo'
        };

        var iceServers = {
            iceServers: options.iceServers || [STUN]
        };

        if (!moz && !options.iceServers) {
            if (parseInt(navigator.userAgent.match(/Chrom(e|ium)\/([0-9]+)\./)[2]) >= 28)
                TURN = {
                    url: 'turn:turn.bistri.com:80',
                    credential: 'homeo',
                    username: 'homeo'
                };
            iceServers.iceServers = [STUN, TURN];
        }

        var optional = {
            optional: []
        };

        if (!navigator.onLine) {
            iceServers = null;
            console.warn('No internet connection detected. No STUN/TURN server is used to make sure local/host candidates are used for peers connection.');
        }

        var peerConnection = new PeerConnection(iceServers, optional);

        openOffererChannel();
        peerConnection.onicecandidate = onicecandidate;

        function onicecandidate(event) {
            if (!event.candidate || !peerConnection) return;
            if (options.onICE) options.onICE(event.candidate);
        }

        var constraints = options.constraints || {
            optional: [],
            mandatory: {
                OfferToReceiveAudio: !!moz,
                OfferToReceiveVideo: !!moz
            }
        };

        function onSdpError(e) {
            console.error('sdp error:', e.name, e.message);
        }

        function onSdpSuccess() {
        }

        function createOffer() {
            if (!options.onOfferSDP) return;

            peerConnection.createOffer(function (sessionDescription) {
                peerConnection.setLocalDescription(sessionDescription);
                options.onOfferSDP(sessionDescription);
            }, onSdpError, constraints);
        }

        function createAnswer() {
            if (!options.onAnswerSDP) return;

            options.offerSDP = new SessionDescription(options.offerSDP);
            peerConnection.setRemoteDescription(options.offerSDP, onSdpSuccess, onSdpError);

            peerConnection.createAnswer(function (sessionDescription) {
                peerConnection.setLocalDescription(sessionDescription);
                options.onAnswerSDP(sessionDescription);
            }, onSdpError, constraints);
        }

        openAnswererChannel();

        createOffer();
        createAnswer();

        var channel;

        function openOffererChannel() {
            if (moz && !options.onOfferSDP) return;

            _openOffererChannel();

            if (!moz) return;
            navigator.mozGetUserMedia({
                audio: true,
                fake: true
            }, function (stream) {
                peerConnection.addStream(stream);
            }, useless);
        }

        function _openOffererChannel() {
            channel = peerConnection.createDataChannel(options.channel || 'data-channel', dataChannelDict);
            setChannelEvents();
        }

        if (options.onAnswerSDP && moz && options.onmessage) openAnswererChannel();

        function openAnswererChannel() {
            peerConnection.ondatachannel = function (event) {
                channel = event.channel;
                setChannelEvents();
            };

            if (!moz) return;
            navigator.mozGetUserMedia({
                audio: true,
                fake: true
            }, function (stream) {
                peerConnection.addStream(stream);
            }, useless);
        }

        function setChannelEvents() {
            channel.onmessage = function (event) {
                options.onmessage(event.data);
            };

            channel.onopen = function () {
                options.onopen(channel);
            };

            channel.onerror = function (e) {
                options.onerror(e);
            };

            channel.onclose = function (e) {
                options.onclose(e);
            };

            channel.push = channel.send;
            channel.send = function (data) {
                try {
                    channel.push(data);
                } catch (e) {
                    setTimeout(function () {
                        channel.send(data);
                    }, 1);
                }
            };
        }

        function useless() {
        }

        return {
            addAnswerSDP: function (sdp) {
                sdp = new SessionDescription(sdp);
                peerConnection.setRemoteDescription(sdp, onSdpSuccess, onSdpError);
            },
            addICE: function (candidate) {
                peerConnection.addIceCandidate(new IceCandidate({
                    sdpMLineIndex: candidate.sdpMLineIndex,
                    candidate: candidate.candidate
                }));
            },

            peer: peerConnection,
            channel: channel,
            sendData: function (message) {
                channel && channel.send(message);
            }
        };
    }
})();
