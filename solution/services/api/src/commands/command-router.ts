import type { OutboundMessage } from '../channels/outbound-message.js';

export type CommandRequest = {
  name: string;
  args: string[];
  rawText: string;
  externalChannelId: string;
  externalSenderId?: string;
  isAdmin: boolean;
};

export interface CommandRouter {
  execute(request: CommandRequest): Promise<OutboundMessage>;
}

export class SimpleCommandRouter implements CommandRouter {
  async execute(request: CommandRequest): Promise<OutboundMessage> {
    switch (request.name) {
      case 'help':
      case 'start':
        return {
          text: [
            'CStats bot is online.',
            '',
            'Commands:',
            '/help',
            '/pending',
            '/top10',
            '/stats <nickname>'
          ].join('\n')
        };
      case 'pending':
        return { text: 'Pending review flow is not wired yet.' };
      default:
        return { text: `Unknown command: /${request.name}. Try /help.` };
    }
  }
}
