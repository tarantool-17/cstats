export type OutboundButton = {
  text: string;
  callbackData: string;
};

export type OutboundMessage = {
  text: string;
  buttons?: OutboundButton[][];
};
