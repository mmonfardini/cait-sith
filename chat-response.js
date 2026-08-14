function chatResponse(text, privateViewer) {
  const msg = { text };
  if (privateViewer) msg.privateMessageViewer = privateViewer;
  return {
    hostAppDataAction: {
      chatDataAction: {
        createMessageAction: {
          message: msg
        }
      }
    }
  };
}

module.exports = { chatResponse };
