import type { OutboundMessage } from '../channels/outbound-message.js';
import type { PlayerAliasRepository } from '../identity/player-alias.repository.js';

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
  constructor(private readonly playerAliases?: PlayerAliasRepository) {}

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
            '/stats <nickname>',
            '',
            'Admin:',
            '/player <display-name> [primary-alias]',
            '/alias <new-alias> <existing-alias>'
          ].join('\n')
        };
      case 'player':
      case 'createplayer':
        return this.createPlayer(request);
      case 'alias':
        return this.saveAlias(request);
      case 'pending':
        return { text: 'Pending review flow is not wired yet.' };
      default:
        return { text: `Unknown command: /${request.name}. Try /help.` };
    }
  }

  private async createPlayer(request: CommandRequest): Promise<OutboundMessage> {
    if (!request.isAdmin) {
      return { text: 'Only admins can create players.' };
    }

    if (!this.playerAliases) {
      return { text: 'Database is not configured; players cannot be created.' };
    }

    const args = parsePlayerArguments(request.rawText);
    if (!args) {
      return {
        text: [
          'Usage: /player <display-name> [primary-alias]',
          'Example: /player valdemar',
          'Example: /player "Valdemar" valdemar'
        ].join('\n')
      };
    }

    const [displayName, primaryAliasText] = args;
    const result = await this.playerAliases.createPlayer(displayName, primaryAliasText);

    switch (result.status) {
      case 'created':
        return {
          text: [
            'Player created successfully.',
            `Player: ${result.playerDisplayName}`,
            `Primary alias: ${result.primaryAliasText}`
          ].join('\n')
        };
      case 'alias_conflict':
        return {
          text: [
            `Alias "${result.primaryAliasText}" is already confirmed for ${result.existingPlayerDisplayName}.`,
            'I did not create a duplicate player.'
          ].join('\n')
        };
    }
  }

  private async saveAlias(request: CommandRequest): Promise<OutboundMessage> {
    if (!request.isAdmin) {
      return { text: 'Only admins can save player aliases.' };
    }

    if (!this.playerAliases) {
      return { text: 'Database is not configured; aliases cannot be saved.' };
    }

    const args = parseAliasArguments(request.rawText);
    if (!args) {
      return {
        text: [
          'Usage: /alias <new-alias> <existing-alias>',
          'Example: /alias valdeman valdemar',
          'Use quotes for nicknames with spaces.'
        ].join('\n')
      };
    }

    const [aliasText, targetAliasText] = args;
    const result = await this.playerAliases.saveConfirmedAlias(aliasText, targetAliasText);

    switch (result.status) {
      case 'saved':
        return {
          text: [
            'Alias saved successfully.',
            `${result.aliasText} -> ${result.playerDisplayName}`,
            `Matched by existing alias: ${result.targetAliasText}`
          ].join('\n')
        };
      case 'already_exists':
        return {
          text: [
            'Alias is already saved.',
            `${result.aliasText} -> ${result.playerDisplayName}`
          ].join('\n')
        };
      case 'target_not_found':
        return {
          text: [
            `Could not find confirmed player alias: ${result.targetAliasText}`,
            `Create it first with: /player ${result.targetAliasText}`
          ].join('\n')
        };
      case 'alias_conflict':
        return {
          text: [
            `Alias "${result.aliasText}" is already confirmed for ${result.existingPlayerDisplayName}.`,
            'I did not change it.'
          ].join('\n')
        };
    }
  }
}

function parsePlayerArguments(rawText: string): [string, string] | null {
  const rest = rawText.trim().replace(/^\/\S+\s*/, '');
  const args = tokenize(rest);

  if (args.length === 1 && args[0].trim().length > 0) {
    return [args[0], args[0]];
  }

  if (args.length === 2 && args.every((arg) => arg.trim().length > 0)) {
    return [args[0], args[1]];
  }

  return null;
}

function parseAliasArguments(rawText: string): [string, string] | null {
  const rest = rawText.trim().replace(/^\/\S+\s*/, '');
  const args = tokenize(rest);

  if (args.length !== 2 || args.some((arg) => arg.trim().length === 0)) {
    return null;
  }

  return [args[0], args[1]];
}

function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;

  for (const char of input) {
    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (current.length > 0) {
        tokens.push(current);
        current = '';
      }
      continue;
    }

    current += char;
  }

  if (current.length > 0) {
    tokens.push(current);
  }

  return tokens;
}
