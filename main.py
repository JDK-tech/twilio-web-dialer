from flask import Flask, render_template, jsonify, request, Response
from twilio.jwt.access_token import AccessToken
from twilio.jwt.access_token.grants import VoiceGrant
from twilio.twiml.voice_response import VoiceResponse, Dial
from twilio.rest import Client
from dotenv import load_dotenv
import os
import logging
import time
import threading

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Load environment variables
load_dotenv()

# Twilio configuration
account_sid = os.getenv('TWILIO_ACCOUNT_SID')
api_key = os.getenv('TWILIO_API_KEY_SID')
api_key_secret = os.getenv('TWILIO_API_KEY_SECRET')
twiml_app_sid = os.getenv('TWIML_APP_SID')
twilio_number = os.getenv('TWILIO_NUMBER')

# The name of the 'client identity'—this must match what your JavaScript dialer uses
CLIENT_IDENTITY = 'web_agent'  # Change this if your frontend uses a different identity for Twilio.Device

# Initialize Twilio client
client = Client(api_key, api_key_secret, account_sid)

app = Flask(__name__)

# Original AGENTS dictionary preserved, but not used for inbound now
AGENTS = {
    'Hailey': os.getenv('AGENT1_NUMBER', 'AGENT1 NUMBER'),
    'Brandi': os.getenv('AGENT2_NUMBER', 'AGENT2 NUMBER'),
    'Nicholle': os.getenv('AGENT3_NUMBER', 'AGENT3 NUMBER'),
    'Rue': os.getenv('AGENT4_NUMBER', 'AGENT4 NUMBER'),
    'Avary': os.getenv('AGENT5_NUMBER', 'AGENT5 NUMBER'),
    'Breezy': os.getenv('AGENT6_NUMBER', 'AGENT6 NUMBER'),
    'Graysen': os.getenv('AGENT7_NUMBER', 'AGENT7 NUMBER'),
    'Stephanie': os.getenv('AGENT8_NUMBER', 'AGENT8 NUMBER')
}

active_calls = {}

@app.route('/')
def home():
    return render_template('home.html', title="Twilio Web Dialer")

@app.route('/token', methods=['GET'])
def get_token():
    # Use a static identity, matching CLIENT_IDENTITY, for the web dialer
    identity = CLIENT_IDENTITY

    if not all([account_sid, api_key, api_key_secret, twiml_app_sid]):
        logger.error("Missing required environment variables")
        return jsonify({'error': 'Missing required environment variables'}), 500

    try:
        access_token = AccessToken(account_sid, api_key, api_key_secret, identity=identity)
        voice_grant = VoiceGrant(outgoing_application_sid=twiml_app_sid, incoming_allow=True)
        access_token.add_grant(voice_grant)

        token = access_token.to_jwt()
        logger.info(f'Generated token for identity: {identity}')
        return jsonify({'token': token, 'identity': identity})

    except Exception as e:
        logger.error(f'Token generation failed: {str(e)}')
        return jsonify({'error': f'Failed to generate token: {str(e)}'}), 500

@app.route('/handle_calls', methods=['POST'])
def handle_calls():
    try:
        logger.info(f'Incoming call request: {request.form}')
        response = VoiceResponse()

        if not twilio_number:
            return jsonify({'error': 'Twilio number not configured'}), 500

        call_sid = request.form.get('CallSid')
        from_number = request.form.get('From')
        to_number = request.form.get('To')

        # Inbound Call Handling (PSTN to Web Dialer now handled by /voice)
        if to_number == twilio_number:
            logger.info(f'Inbound call from {from_number}')
            response.say("Inbound calls are handled via the web dialer.")
        # Outbound Call Handling
        else:
            dial = Dial(callerId=twilio_number)
            dial.number(to_number)
            response.append(dial)

        logger.info('Call routing completed')
        return str(response)

    except Exception as e:
        logger.error(f'Call handling failed: {str(e)}')
        response = VoiceResponse()
        response.say('An error occurred while connecting your call.')
        return str(response)

@app.route('/voice', methods=['POST'])
def voice():
    """
    Handle inbound PSTN calls and send them to the web dialer client.
    """
    try:
        response = VoiceResponse()
        dial = Dial()
        dial.client(CLIENT_IDENTITY)  # Must match your JavaScript/client identity
        response.append(dial)
        logger.info(f'Inbound call routed to client: {CLIENT_IDENTITY}')
        return Response(str(response), mimetype='application/xml')
    except Exception as e:
        logger.error(f'Error in inbound /voice route: {str(e)}')
        response = VoiceResponse()
        response.say("There was an error connecting your call. Please try again later.")
        return Response(str(response), mimetype='application/xml')

@app.route('/transfer_call', methods=['POST'])
def transfer_call():
    try:
        call_sid = request.form.get('CallSid')
        target_number = request.form.get('TargetAgent')

        if not call_sid or not target_number:
            return jsonify({'error': 'Missing required parameters'}), 400

        client.calls(call_sid).update(
            method='POST',
            url=f'https://twilio-web-dialer.onrender.com/handle_calls?To={target_number}'
        )

        logger.info(f'Transferred call {call_sid} to {target_number}')
        return jsonify({'success': True, 'message': 'Call transferred successfully'})

    except Exception as e:
        logger.error(f'Call transfer failed: {str(e)}')
        return jsonify({'error': str(e)}), 500

@app.route('/mute_call', methods=['POST'])
def mute_call():
    try:
        call_sid = request.form.get('CallSid')
        mute = request.form.get('Mute', 'True').lower() == 'true'

        if not call_sid:
            return jsonify({'error': 'Missing CallSid parameter'}), 400

        client.calls(call_sid).update(
            method='POST',
            url=f'https://twilio-web-dialer.onrender.com/handle_calls?Mute={str(mute)}'
        )

        logger.info(f'{"Muted" if mute else "Unmuted"} call {call_sid}')
        return jsonify({'success': True, 'message': f'Call {call_sid} {"muted" if mute else "unmuted"}'})

    except Exception as e:
        logger.error(f'Call mute failed: {str(e)}')
        return jsonify({'error': str(e)}), 500

def check_for_auto_transfer():
    while True:
        current_time = time.time()
        calls_to_transfer = []

        for call_sid, start_time in active_calls.items():
            if current_time - start_time >= 23:
                calls_to_transfer.append(call_sid)

        for call_sid in calls_to_transfer:
            try:
                call = client.calls(call_sid).fetch()
                if call.status in ['ringing', 'in-progress']:
                    client.calls(call_sid).update(
                        method='POST',
                        url=f'https://twilio-web-dialer.onrender.com/handle_calls?To={AGENTS["Stephanie"]}'
                    )
                    logger.info(f'Auto-transferred call {call_sid} to backup agent')
                del active_calls[call_sid]
            except Exception as e:
                logger.error(f'Auto-transfer failed for call {call_sid}: {str(e)}')
        time.sleep(1)

transfer_thread = threading.Thread(target=check_for_auto_transfer, daemon=True)
transfer_thread.start()

port = int(os.environ.get("PORT", 3000))
if __name__ == "__main__":
    app.run(host='0.0.0.0', port=port, debug=True)
