$(function () {
    var device;
    let audioContext = null;
    let stream = null;
    let currentAgentIndex = 0;

    // Initialize audio context on page load
    async function initAudio() {
        try {
            if (!audioContext) {
                audioContext = new (window.AudioContext || window.webkitAudioContext)();
                console.log("Audio context initialized");
            }
        } catch (error) {
            console.error("Audio context initialization failed:", error);
        }
    }

    // Request user media permissions
    async function requestMedia() {
        try {
            stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    sampleRate: 48000
                }
            });
            console.log("Media permissions granted");
            return stream;
        } catch (error) {
            console.error("Media permissions error:", error);
            throw error;
        }
    }

    // Handle device ready event
    function handleDeviceReady() {
        log("Twilio.Device Ready!");
        
        // Set up audio devices
        Twilio.Device.setup(stream);
        
        // Handle audio device changes
        navigator.mediaDevices.addEventListener('devicechange', async () => {
            const devices = await navigator.mediaDevices.enumerateDevices();
            const audioInputs = devices.filter(device => device.kind === 'audioinput');
            console.log("Available audio inputs:", audioInputs);
        });
        
        // Set default audio output device
        Twilio.Device.audio.setOutputDevice("default")
            .then(() => console.log("Default audio output set"))
            .catch(error => console.error("Failed to set audio output:", error));
        
        // Resume audio context after user interaction
        document.addEventListener("click", async () => {
            if (audioContext.state === "suspended") {
                await audioContext.resume();
                console.log("Audio context resumed");
            }
        });
    }

    // Fetch token with error handling
    async function fetchTwilioToken() {
        try {
            const response = await $.getJSON("./token");
            log("Got a token.");
            console.log("Token: " + response.token);
            
            // Initialize device with token
            device = new Twilio.Device(response.token, {
                codecPreferences: ["opus", "pcmu"],
                fakeLocalDTMF: true,
                enableRingingState: true,
                debug: true,
                params: {
                    DeviceInfo: {
                        sdkVersion: "js-" + Twilio.Device.version,
                        platform: navigator.platform,
                        browser: navigator.userAgent
                    }
                }
            });
            
            // Set up event listeners
            device.on("ready", handleDeviceReady);
            device.on("error", handleError);
            device.on("connect", handleConnect);
            device.on("incoming", handleIncoming);
            
            // Add sequential ring group support
            device.on("disconnect", function(conn) {
                currentAgentIndex = 0;
                log("Call disconnected. Resetting agent index.");
            });
            
        } catch (error) {
            console.error("Token fetch failed:", error);
            log("Could not get a token from server! Retrying...");
            setTimeout(fetchTwilioToken, 5000);
        }
    }

    // Handle device errors
    function handleError(error) {
        console.error("Twilio Device Error:", error);
        
        if (error.message.includes("WSTransport socket error")) {
            log("WebSocket error detected. Retrying in 5 seconds...");
            setTimeout(fetchTwilioToken, 5000);
        }
    }

    // Handle call connection
    function handleConnect(conn) {
        log("Successfully established call!");
        $('#modal-call-in-progress').modal('show');
        
        conn.on("accept", function () {
            console.log("Call accepted, audio should be working!");
            // Ensure audio context is active
            if (audioContext.state === "suspended") {
                audioContext.resume();
            }
        });
        
        conn.on("disconnect", function () {
            log("Call ended.");
            $('.modal').modal('hide');
        });
        
        // Add transfer button
        $('#btnTransfer').off().on('click', function() {
            const targetAgent = $('#transferAgent').val();
            if (targetAgent) {
                transferCall(conn, targetAgent);
            }
        });
        
        // Add mute button
        $('#btnMute').off().on('click', function() {
            const isMuted = $(this).data('muted') === true;
            muteCall(conn, !isMuted);
            $(this).data('muted', !isMuted);
            $(this).text(isMuted ? 'Unmute' : 'Mute');
        });
    }

    // Handle incoming calls
    function handleIncoming(conn) {
        log("Incoming connection from " + conn.parameters.From);
        $("#callerNumber").text(conn.parameters.From);
        $("#txtPhoneNumber").text(conn.parameters.From);
        $('#modal-incomming-call').modal('show');
        
        $('.btnReject').off().on('click', function () {
            $('.modal').modal('hide');
            log("Rejected call...");
            conn.reject();
        });
        
        $('.btnAcceptCall').off().on('click', function () {
            $('.modal').modal('hide');
            log("Accepted call...");
            conn.accept();
        });
    }

    // Transfer call function
    function transferCall(conn, targetAgent) {
        log("Transferring call to " + targetAgent);
        $.post("./transfer_call", {
            CallSid: conn.parameters.CallSid,
            TargetAgent: targetAgent
        })
        .done(function(response) {
            if (response.success) {
                log("Call transferred successfully");
                conn.disconnect();
            } else {
                log("Transfer failed: " + response.error);
            }
        })
        .fail(function(error) {
            log("Transfer request failed: " + error.statusText);
        });
    }

    // Mute call function
    function muteCall(conn, mute) {
        log(mute ? "Muting call..." : "Unmuting call...");
        $.post("./mute_call", {
            CallSid: conn.parameters.CallSid,
            Mute: mute
        })
        .done(function(response) {
            if (response.success) {
                log(mute ? "Call muted successfully" : "Call unmuted successfully");
            } else {
                log(mute ? "Mute failed: " + response.error : "Unmute failed: " + response.error);
            }
        })
        .fail(function(error) {
            log(mute ? "Mute request failed: " + error.statusText : "Unmute request failed: " + error.statusText);
        });
    }

    // Initialize application
    async function init() {
        try {
            // Initialize audio context
            await initAudio();
            
            // Request media permissions
            await requestMedia();
            
            // Fetch token and initialize device
            await fetchTwilioToken();
            
            // Bind call buttons
            $('#btnDial').on('click', async function () {
                $('#modal-dial').modal('hide');
                const params = { To: $("#phoneNumber").val() };
                $("#txtPhoneNumber").text(params.To);
                
                // Ensure audio context is active
                if (audioContext.state === "suspended") {
                    await audioContext.resume();
                }
                
                console.log("Calling " + params.To + "...");
                if (device) {
                    const outgoingConnection = device.connect(params);
                    outgoingConnection.on("ringing", function () {
                        log("Ringing...");
                    });
                    
                    outgoingConnection.on("error", function (error) {
                        log("Call error: " + error.message);
                        $('.modal').modal('hide');
                    });
                }
            });
            
            // Bind hang up button
            $('.btnHangUp').on('click', function () {
                $('.modal').modal('hide');
                log("Hanging up...");
                if (device) {
                    device.disconnectAll();
                }
            });
            
            // Add sequential ring group UI
            $('#btnNextAgent').on('click', function() {
                currentAgentIndex = (currentAgentIndex + 1) % 7; // Stay within agents 1-7
                const nextAgent = `agent${currentAgentIndex + 1}`;
                if (device) {
                    const conn = device.activeConnection();
                    if (conn) {
                        transferCall(conn, nextAgent);
                    }
                }
            });
            
        } catch (error) {
            console.error("Initialization failed:", error);
            log("Initialization failed. Please refresh the page.");
        }
    }

    // Activity log
    function log(message) {
        const logDiv = document.getElementById("log");
        logDiv.innerHTML += "<p>&gt;&nbsp;" + message + "</p>";
        logDiv.scrollTop = logDiv.scrollHeight;
    }

    // Start initialization
    init();
});