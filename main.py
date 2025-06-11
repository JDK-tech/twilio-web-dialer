from flask import Flask, render_template, jsonify, request
from twilio.jwt.access_token import AccessToken
from twilio.jwt.access_token.grants import VoiceGrant
from twilio.twiml.voice_response import VoiceResponse, Dial
from twilio.rest import Client
from dotenv import load_dotenv
import os
import logging
import time
from datetime import datetime

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

# Store active calls and their timestamps
active_calls = {}

# Agent configuration
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

# Store current position in agent sequence
current_agent_index = 0

@app.route('/')
def home():
    return render_template('home.html', title="In browser calls")

@app.route('/token', methods=['GET'])
def get_token():
    # Use a unique identity for each user
    identity = request.args.get('client', 'user')
    
    if not all([account_sid, api_key, api_key_secret, twiml_app_sid]):
        return jsonify({'error': 'Missing required environment variables'}), 500

    try:
        access_token = AccessToken(account_sid, api_key, api_key_secret, identity=identity)
        voice_grant = VoiceGrant(
            outgoing_application_sid=twiml_app_sid,
            incoming_allow=True
        )
        access_token.add_grant(voice_grant)
        
        logger.info(f'Generated token for identity: {identity}')
        return jsonify({'token': access_token.to_jwt(), 'identity': identity})

    except Exception as e:
        logger.error(f'Token generation failed: {str(e)}')
        return jsonify({'error': f'Failed to generate token: {str(e)}'}), 500

@app.route('/handle_calls', methods=['POST'])
def handle_calls():
    try:
        # Log incoming request data
        logger.info(f'Incoming call request: {request.form}')
        
        # Create TwiML response
        response = VoiceResponse()
        
        # Ensure Twilio credentials exist
        if not twilio_number:
            return jsonify({'error': 'Twilio number not configured'}), 500

        # Handle incoming/outgoing calls
        if 'To' in request.form and request.form['To'] != twilio_number:
            # Outbound call
            logger.info('Outbound call initiated')
            dial = Dial(callerId=twilio_number)
            dial.number(request.form['To'])
        else:
            # Incoming call
            logger.info('Incoming call detected')
            caller = request.form.get('From', 'Unknown')
            
            # Sequential ring group logic
            current_agent = AGENTS['Hailey']  # Start with Agent 1
            
            # Check if we're in the middle of a sequential transfer
            if 'CurrentAgentIndex' in request.form:
                current_agent_index = int(request.form['CurrentAgentIndex'])
                if current_agent_index < 7:  # Don't go past Agent 7
                    current_agent = AGENTS[f'agent{current_agent_index + 1}']
            
            dial = Dial(callerId=twilio_number)
            dial.number(current_agent)
            
            # Add current position for next transfer
            response.append(dial)
            response.append(f'<Parameter name="CurrentAgentIndex" value="{current_agent_index}"/>')

        # Store call timestamp for auto-transfer
        if 'CallSid' in request.form:
            active_calls[request.form['CallSid']] = time.time()

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
        target_agent = request.form.get('TargetAgent')
        
        if not call_sid or not target_agent:
            return jsonify({'error': 'Missing required parameters'}), 400

        # Validate target agent
        if target_agent not in AGENTS:
            return jsonify({'error': 'Invalid target agent'}), 400

        # Update call with transfer
        call = client.calls(call_sid).update(
            method='POST',
            url=f'http://your-domain.com/handle_calls?TargetAgent={AGENTS[target_agent]}'
        )
        
        logger.info(f'Transferred call {call_sid} to {target_agent}')
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

        # Update call with mute status
        call = client.calls(call_sid).update(
            method='POST',
            url=f'http://your-domain.com/handle_calls?Mute={str(mute)}'
        )
        
        logger.info(f'{"Muted" if mute else "Unmuted"} call {call_sid}')
        return jsonify({'success': True, 'message': f'Call {call_sid} {"muted" if mute else "unmuted"}'})

    except Exception as e:
        logger.error(f'Call mute failed: {str(e)}')
        return jsonify({'error': str(e)}), 500

def check_for_auto_transfer():
    """Background task to check for calls that need auto-transfer"""
    while True:
        current_time = time.time()
        calls_to_transfer = []
        
        for call_sid, start_time in active_calls.items():
            if current_time - start_time >= 23:  # 23 seconds
                calls_to_transfer.append(call_sid)
        
        for call_sid in calls_to_transfer:
            try:
                # Get the call
                call = client.calls(call_sid).fetch()
                
                # If call is still ringing or in progress
                if call.status in ['ringing', 'in-progress']:
                    # Transfer to backup agent (Agent 8)
                    client.calls(call_sid).update(
                        method='POST',
                        url=f'http://your-domain.com/handle_calls?TargetAgent={AGENTS["Stephanie"]}'
                    )
                    logger.info(f'Auto-transferred call {call_sid} to backup agent')
                
                # Remove from active calls
                del active_calls[call_sid]
                
            except Exception as e:
                logger.error(f'Auto-transfer failed for call {call_sid}: {str(e)}')
        
        time.sleep(1)  # Check every second

# Start auto-transfer checker in background
import threading
auto_transfer_thread = threading.Thread(target=check_for_auto_transfer, daemon=True)
auto_transfer_thread.start()

if __name__ == "__main__":
    app.run(host='0.0.0.0', port=3000, debug=True)