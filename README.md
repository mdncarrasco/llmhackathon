# GPT Obfuscator via Gmail

## Overview

This project began as an ambitious attempt to win the [LLM Hackathon](https://llmhackathon.dev/). The initial goal was to create an innovative solution leveraging large language models to stand out in the competition. However, as development progressed, it transformed into something entirely different—a GPT obfuscator that interacts with users through Gmail.

In the end, we created a unique tool that automates email responses using AI models like CodeGPT and Mistral. If there's any chance of winning the hackathon with this project, perhaps the judges should evaluate their mental health! 😂

## Features

- **Automated Email Processing**: The script processes incoming emails in Gmail, categorizes them, and generates automated responses.
- **Integration with AI Models**: Utilizes CodeGPT(Agent) and Mistral AI models to analyze email content and generate appropriate replies.
- **Ticket Management System**: Creates and updates tickets in a Google Sheet based on email interactions. (tiembla https://gurusup.com/)
- **Dynamic Decision Making**: Determines whether to create a new ticket, respond to an existing one, or close a ticket based on the latest email content.
- **Markdown to HTML Conversion**: Converts AI-generated responses from Markdown to HTML for better email formatting.

## How It Works

1. **Email Retrieval**: The script searches for new emails in Gmail that haven't been labeled yet.
2. **Action Determination**: For each email thread, it analyzes the last message to decide on one of the following actions:
   - **CREATE**: If it's a new inquiry, it creates a ticket.
   - **RESPOND**: If the conversation is ongoing, it generates a response.
   - **CLOSE**: If the user indicates closure, it closes the ticket.
3. **AI Analysis**:
   - **Mistral AI**: Extracts relevant information from emails and determines the user's intent.
   - **CodeGPT**: Generates detailed responses based on the email content.
4. **Response Handling**: Sends the generated responses back to the user via email.
5. **Ticket Updates**: Logs and updates the ticket status in a Google Sheet for tracking.

## Installation and Setup

1. **Clone the Repository**: Download or clone this repository to your local machine.
2. **Google Apps Script**: Copy the script into a new Google Apps Script project associated with your Google account.
3. **API Keys Configuration**:
   - Set up script properties with your API keys:
     - `CODEGPT_API_KEY`
     - `CODEGPT_AGENT_ID`
     - `MISTRAL_API_KEY`
4. **Google Sheet Setup**:
   - Create a Google Sheet named 'Tickets'.
   - Set up columns for Ticket ID, Info, Origin, Category, Message Count, Created Date, Updated Date, Sender, Status, Confidence, and Link.
5. **Permissions**: Ensure the script has the necessary permissions to access Gmail and Google Sheets.
6. **Triggers**: Set up time-driven triggers to run the `procesarCorreos` function periodically.

## Usage

- **Processing Emails**: The script automatically processes emails, determines the required action, and interacts with the user accordingly.
- **Customizable Responses**: Modify the prompts and responses in the script to tailor the interaction to your needs.
- **Error Handling**: Logs are in place to help troubleshoot any issues during execution.

## Disclaimer

This project was developed with a mix of ambition and humor. While it may not fulfill the original objective of winning the LLM Hackathon, it showcases a creative approach to AI-powered email automation. If, by some twist of fate, this project wins the hackathon, the judges might need a friendly check on their mental well-being! 😂

## Contributing

Contributions are welcome! Feel free to submit issues or pull requests to improve the project.

## License

This project is licensed under the [MIT License](LICENSE).
