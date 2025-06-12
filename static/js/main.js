$(function () {
    var device;
    let audioContext = null;
    let stream = null;
    let currentAgentIndex = 0;
    let currentConnection = null;  // Track active call for mute/unmute

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

    function handleDeviceReady() {
        log("Twilio.Device Ready!");
        Twilio.Device.setup(stream);

        navigator.mediaDevices.addEventListener('devicechange', async () => {
            const devices = await navigator.mediaDevices.enumerateDevices();
            const audioInputs = devices.filter(device => device.kind === 'audioinput');
            console.log("Available audio inputs:", audioInputs);
        });

        Twilio.Device.audio.setOutputDevice("default")
            .then(() => console.log("Default audio output set"))
            .catch(error => console.error("Failed to set audio output:", error));

        document.addEventListener("click", async () => {
            if (audioContext.state === "suspended") {
                await audioContext.resume();
                console.log("Audio context resumed");
            }
        });
    }

    async function fetchTwilioToken() {
        try {
            const response = await $.getJSON("./token");
            log("Got a token.");
            console.log("Token: " + response.token);

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

        } catch (error) {
            console.error("Token fetch failed:", error);
            log("Could not get a token from server! Retrying...");
            setTimeout(fetchTwilioToken, 5000);
        }
    }

    function handleError(error) {
        console.error("Twilio Device Error:", error);
        log("Twilio Error: " + error.message);

        if (error.message.includes("WSTransport socket error")) {
            log("WebSocket error detected. Retrying in 5 seconds...");
            setTimeout(fetchTwilioToken, 5000);
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
                const isMuted = currentConnection.isMuted();
                currentConnection.mute(!isMuted);
                log(isMuted ? "Unmuting call..." : "Muting call...");
                $(this).data('muted', !isMuted);
                $(this).text(isMuted ? "Mute" : "Unmute");
            } else {
                log("No active call to mute.");
            }
        });
    }

    function handleIncoming(conn) {
        log("Incoming connection from " + conn.parameters.From);
        $("#callerNumber").text(conn.parameters.From);
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
            currentConnection = conn;  // Store active connection
        });
    }

    // **Fixed Call Button Logic**
    $('#btnDial').on('click', function () {
        const phoneNumber = $("#phoneNumber").val();  // Get the entered number
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
            await requestMedia();
            await fetchTwilioToken();
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
