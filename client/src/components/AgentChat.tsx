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
}

export function AgentChat({ socketRef, isAuthenticated, account }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const socket = socketRef.current;
    if (!socket) return;

    const onHistory = (history: ChatMessage[]) => {
      setMessages(history);
    };

    const onMessage = (msg: ChatMessage) => {
      setMessages(prev => [...prev, msg].slice(-100));
      if (!isOpen) setUnread(prev => prev + 1);
    };

    socket.on('chatHistory', onHistory);
    socket.on('chatMessage', onMessage);

    return () => {
      socket.off('chatHistory', onHistory);
      socket.off('chatMessage', onMessage);
    };
  }, [socketRef, isOpen]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (isOpen) setUnread(0);
  }, [isOpen]);

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

  if (!isOpen) {
    return (
      <button className="chat-fab" onClick={() => setIsOpen(true)}>
        💬
        {unread > 0 && <span className="chat-badge">{unread}</span>}
      </button>
    );
  }

  return (
    <div className="chat-panel">
      <div className="chat-header">
        <span className="chat-title">Agent Chat</span>
        <span className="chat-online">{messages.length > 0 ? '● Live' : ''}</span>
        <button className="chat-close" onClick={() => setIsOpen(false)}>✕</button>
      </div>
      <div className="chat-messages">
        {messages.length === 0 && (
          <div className="chat-empty">No messages yet. Say hello!</div>
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
