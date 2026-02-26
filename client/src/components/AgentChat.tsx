import { useState, useEffect, useRef } from 'react';
import type { Socket } from 'socket.io-client';

interface ChatMessage {
  id: string;
  sender: string;
  content: string;
  timestamp: number;
  isAgent: boolean;
}

interface Props {
  socketRef: React.RefObject<Socket | null>;
  isAuthenticated: boolean;
  account: string | null;
  connected?: boolean;
}

export function AgentChat({ socketRef, isAuthenticated, account, connected }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const shouldAutoScroll = useRef(true);
  const messagesContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const socket = socketRef.current;
    if (!socket) return;

    const onHistory = (history: ChatMessage[]) => {
      setMessages(history.slice(-25));
    };

    const onMessage = (msg: ChatMessage) => {
      setMessages(prev => [...prev, msg].slice(-25));
    };

    socket.on('chatHistory', onHistory);
    socket.on('chatMessage', onMessage);

    // If already connected, request chat history (may have missed the initial emit)
    if (socket.connected) {
      socket.emit('requestChatHistory');
    }

    return () => {
      socket.off('chatHistory', onHistory);
      socket.off('chatMessage', onMessage);
    };
  }, [socketRef, connected]);

  // Track if user has scrolled up
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;
    const handleScroll = () => {
      const atBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 40;
      shouldAutoScroll.current = atBottom;
    };
    container.addEventListener('scroll', handleScroll);
    return () => container.removeEventListener('scroll', handleScroll);
  }, []);

  // Auto-scroll on new messages
  useEffect(() => {
    if (shouldAutoScroll.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  const sendMessage = () => {
    if (!input.trim() || !socketRef.current) return;
    const shortAddr = account ? account.slice(0, 6) + '...' + account.slice(-4) : 'Anon';
    socketRef.current.emit('chatMessage', { sender: shortAddr, content: input.trim() });
    setInput('');
  };

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="chat-inline">
      <div className="chat-inline-header">
        <span className="chat-title">Live Chat</span>
        <span className="chat-online">{messages.length > 0 ? '● Live' : ''}</span>
      </div>
      <div className="chat-inline-messages" ref={messagesContainerRef}>
        {messages.length === 0 && (
          <div className="chat-empty">No messages yet</div>
        )}
        {messages.map(msg => (
          <div key={msg.id} className={`chat-msg ${msg.isAgent ? 'agent' : 'user'}`}>
            <div className="chat-msg-header">
              <span className={`chat-sender ${msg.isAgent ? 'agent' : ''}`}>
                {msg.isAgent ? '🤖 ' : ''}{msg.sender}
              </span>
              <span className="chat-time">{formatTime(msg.timestamp)}</span>
            </div>
            <div className="chat-msg-content">{msg.content}</div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>
      {isAuthenticated ? (
        <div className="chat-input-row">
          <input
            className="chat-input"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && sendMessage()}
            placeholder="Type a message..."
            maxLength={500}
          />
          <button className="chat-send" onClick={sendMessage} disabled={!input.trim()}>
            ➤
          </button>
        </div>
      ) : (
        <div className="chat-login-prompt">Connect wallet to chat</div>
      )}
    </div>
  );
}
