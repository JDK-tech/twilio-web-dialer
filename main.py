from flask import Flask, render_template, jsonify, request
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

# Initialize Twilio client
client = Client(api_key, api_key_secret, account_sid)

app = Flask(__name__)

# List of agents
AGENTS = {
    'Hailey': os.getenv('AGENT1_NUMBER', '+18108191394'),
    'Brandi': os.getenv('AGENT2_NUMBER', '+13137658399'),
    'Nicholle': os.getenv('AGENT3_NUMBER', '+15177778712'),
    'Rue': os.getenv('AGENT4_NUMBER', '+18105444469'),
    'Avary': os.getenv('AGENT5_NUMBER', '+17346009019'),
    'Breezy': os.getenv('AGENT6_NUMBER', '+17343664154'),
    'Graysen': os.getenv('AGENT7_NUMBER', '+15863023066'),
    'Stephanie': os.getenv('AGENT8_NUMBER', '+15177451309')  # Backup agent
}

# Track active calls
active_calls = {}

@app.route('/')
def home():
    return render_template('home.html', title="In browser calls")

@app.route('/token', methods=['GET'])
def get_token():
    identity = request.args.get('client', 'user')
    
    if not all([account_sid, api_key, api_key_secret, twiml_app_sid]):
        return jsonify({'error': 'Missing required environment variables'}), 500

    try:
        access_token = AccessToken(account_sid, api_key, api_key_secret, identity=identity)
        voice_grant = VoiceGrant(outgoing_application_sid=twiml_app_sid, incoming_allow=True)
        access_token.add_grant(voice_grant)
        
        logger.info(f'Generated token for identity: {identity}')
        return jsonify({'token': access_token.to_jwt(), 'identity': identity})

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

        if call_sid:
            active_calls[call_sid] = time.time()

        # Assign the first agent
        agent_numbers = list(AGENTS.values())
        dial = Dial(callerId=twilio_number)
        dial.number(agent_numbers[0])  # Starts with the first agent
        
        response.append(dial)
        logger.info('Call routing completed')
        return str(response)

    except Exception as e:
        logger.error(f'Call handling failed: {str(e)}')
        response = VoiceResponse()
        response.say('An error occurred while connecting your call.')
        return str(response)

@app.route('/transfer_call', methods=['POST'])
def transfer_call():
    try:
        call_sid = request.form.get('CallSid')
        target_number = request.form.get('TargetNumber')

        if not call_sid or not target_number:
            return jsonify({'error': 'Missing required parameters'}), 400

        call = client.calls(call_sid).update(
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
    """Background task to check for unanswered calls and transfer them."""
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
                        url=f'https://twilio-web-dialer.onrender.com/handle_calls?To={AGENTS["Stephanie"]}'  # Transfers to backup agent
                    )
                    logger.info(f'Auto-transferred call {call_sid} to backup agent')

                del active_calls[call_sid]

            except Exception as e:
                logger.error(f'Auto-transfer failed for call {call_sid}: {str(e)}')

        time.sleep(1)

# Start auto-transfer monitoring in background
transfer_thread = threading.Thread(target=check_for_auto_transfer, daemon=True)
transfer_thread.start()

if __name__ == "__main__":
    app.run(host='0.0.0.0', port=3000, debug=True)
