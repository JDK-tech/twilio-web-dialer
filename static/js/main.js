$(function () {
    var device;
    let audioContext = null;
    let stream = null;
    let currentAgentIndex = 0;
    let currentConnection = null;  // Track active call for mute/unmute

    // -- Agent list (update display names and numbers to match your backend/AGENTS dictionary) --
    const AGENTS = {
        "Hailey": "+18108191394",
        "Brandi": "+13137658399",
        "Nicholle": "+15177778712",
        "Rue": "+18105444469",
        "Avary": "+17346009019",
        "Breezy": "+17343664154",
        "Graysen": "+15863023066",
        "Stephanie": "+15177451309"
    };

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

    async function fetchTwilioToken() {
        try {
            const response = await $.getJSON("./token");
            log("Got a token.");
            console.log("Token: " + response.token);

            if (device) {
                // If device already exists (token refresh), update token
                device.updateToken(response.token);
                return;
            }

            device = new Twilio.Device(response.token, {
                codecPreferences: ["opus", "pcmu"],
                fakeLocalDTMF: true,
                enableRingingState: true,
                debug: true
            });

            device.on("ready", handleDeviceReady);
            device.on("error", handleError);
            device.on("connect", handleConnect);
            device.on("incoming", handleIncoming);
            device.on("disconnect", function () {
                currentAgentIndex = 0;
                log("Call disconnected. Resetting agent index.");
                currentConnection = null;  // Clear connection after call ends
            });
            device.on("tokenWillExpire", function () {
                log("Token will expire soon. Fetching a new one...");
                fetchTwilioToken();
            });
            device.on("tokenExpired", function () {
                log("Token expired! Fetching a new one...");
                fetchTwilioToken();
            });
            device.on("registering", function () {
                log("Twilio Device is registering...");
            });
            device.on("registered", function () {
                log("Twilio Device is registered.");
            });
            device.on("unregistered", function () {
                log("Twilio Device is unregistered.");
            });

        } catch (error) {
            console.error("Token fetch failed:", error);
            log("Could not get a token from server! Retrying...");
            setTimeout(fetchTwilioToken, 5000);
        }
    }

    function handleDeviceReady() {
        log("Twilio.Device Ready!");

        navigator.mediaDevices.addEventListener('devicechange', async () => {
            const devices = await navigator.mediaDevices.enumerateDevices();
            const audioInputs = devices.filter(device => device.kind === 'audioinput');
            console.log("Available audio inputs:", audioInputs);
        });

        Twilio.Device.audio.setOutputDevice("default")
            .then(() => console.log("Default audio output set"))
            .catch(error => console.error("Failed to set audio output:", error));

        document.addEventListener("click", async () => {
            if (audioContext && audioContext.state === "suspended") {
                await audioContext.resume();
                console.log("Audio context resumed");
            }
        });

        // Log device status for debugging
        if (device) {
            log("Device status: " + device.status());
        }
    }

    function handleError(error) {
        console.error("Twilio Device Error:", error);
        log("Twilio Error: " + error.message);

        if (error.message.includes("WSTransport socket error")) {
            log("WebSocket error detected. Retrying in 5 seconds...");
            setTimeout(fetchTwilioToken, 5000);
        } else if (error.message.includes("Authorization token expired") || error.message.includes("JWT Token Expired")) {
            log("Authorization token expired, fetching new one...");
            fetchTwilioToken();
        }
    }

    function handleConnect(conn) {
        log("Successfully established call!");
        $('#modal-call-in-progress').modal('show');
        currentConnection = conn;  // Store active connection

        conn.on("disconnect", function () {
            log("Call ended.");
            $('.modal').modal('hide');
            currentConnection = null;  // Reset on disconnect
        });

        $('#btnMute').off().on('click', function () {
            if (currentConnection) {
                const isMuted = $(this).data('muted') === true;
                currentConnection.mute(!isMuted);
                log(isMuted ? "Unmuting call..." : "Muting call...");
                $(this).data('muted', !isMuted);
                $(this).text(isMuted ? "Mute" : "Unmute");
            } else {
                log("No active call to mute.");
            }
        });

        $('#btnHangUp').on('click', function () {
            if (currentConnection) {
                log("Ending call...");
                currentConnection.disconnect();  // Ensure active connection ends
                currentConnection = null;  // Reset connection tracking
                $('.modal').modal('hide');  // Hide active call UI
            } else {
                log("No active call to end.");
            }
        });
    }

    function handleIncoming(conn) {
        log("Incoming connection from " + conn.parameters.From);
        $("#callerNumber").text(conn.parameters.From);

        // Setup Transfer modal UI to initial state
        $('#transferOptions').hide();
        $('#transferAgent').empty();
        $('.btnAcceptCall').show();
        $('.btnReject').show();
        $('.btnTransfer').show();
        $('.btnCancelTransfer').hide();

        $('#modal-incomming-call').modal('show');

        // Accept logic
        $('.btnAcceptCall').off().on('click', function () {
            $('#modal-incomming-call').modal('hide');
            log("Accepted call...");
            conn.accept();
            currentConnection = conn;  // Store active connection
        });

        // Reject logic
        $('.btnReject').off().on('click', function () {
            $('#modal-incomming-call').modal('hide');
            log("Rejected call...");
            conn.reject();
        });

        // Transfer logic
        $('.btnTransfer').off().on('click', function () {
            // Populate agent dropdown
            $('#transferAgent').empty();
            for (const [agent, number] of Object.entries(AGENTS)) {
                $('#transferAgent').append($('<option>', {
                    value: number,
                    text: agent + " (" + number + ")"
                }));
            }
            $('#transferOptions').show();
            $('.btnAcceptCall, .btnReject, .btnTransfer').hide();
            $('.btnCancelTransfer').show();
        });

        // Cancel transfer
        $('.btnCancelTransfer').off().on('click', function () {
            $('#transferOptions').hide();
            $('.btnAcceptCall, .btnReject, .btnTransfer').show();
            $('.btnCancelTransfer').hide();
        });

        // Confirm Transfer: double-click dropdown or add a confirm button if you prefer
        $('#transferAgent').off('dblclick').on('dblclick', function () {
            transferToAgent();
        });

        // If you prefer a confirm button, uncomment and implement in your HTML:
        // $('.btnTransferConfirm').off().on('click', transferToAgent);

        function transferToAgent() {
            const targetNumber = $('#transferAgent').val();
            if (!targetNumber) { log("Please select an agent."); return; }
            log("Transferring call to " + targetNumber + " ...");

            $('#modal-incomming-call').modal('hide');

            // POST to your Flask backend
            $.ajax({
                url: '/transfer_call',
                type: 'POST',
                data: {
                    CallSid: conn.parameters.CallSid,
                    TargetAgent: targetNumber
                },
                success: function (response) {
                    log("Transfer successful: " + (response.message || ""));
                },
                error: function (xhr) {
                    log("Transfer error: " + (xhr.responseJSON ? xhr.responseJSON.error : xhr.statusText));
                }
            });

            // Optionally reject the connection in browser
            conn.reject();
        }
    }

    $('#btnDial').on('click', function () {
        const phoneNumber = $("#phoneNumber").val();
        if (!phoneNumber) {
            log("No phone number entered.");
            return;
        }

        log("Dialing " + phoneNumber + "...");

        if (device) {
            const conn = device.connect({ To: phoneNumber });
            conn.on("error", function (error) {
                log("Call failed: " + error.message);
            });
        } else {
            log("Twilio Device not ready.");
        }
    });

    async function init() {
        try {
            await initAudio();
            await requestMedia();       // Preemptively get audio permission
            await fetchTwilioToken();   // Now set up device and handlers
        } catch (error) {
            console.error("Initialization failed:", error);
            log("Initialization failed. Please refresh the page.");
        }
    }

    function log(message) {
        const logDiv = document.getElementById("log");
        logDiv.innerHTML += "<p>&gt;&nbsp;" + message + "</p>";
        logDiv.scrollTop = logDiv.scrollHeight;
    }

    init();
});
