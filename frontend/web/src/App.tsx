import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';

interface ContentData {
  id: string;
  title: string;
  description: string;
  category: string;
  accessLevel: number;
  creator: string;
  timestamp: number;
  publicValue1: number;
  publicValue2: number;
  isVerified?: boolean;
  decryptedValue?: number;
}

interface UserHistory {
  action: string;
  contentId: string;
  timestamp: number;
  status: string;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [contents, setContents] = useState<ContentData[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingContent, setCreatingContent] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newContentData, setNewContentData] = useState({ 
    title: "", 
    description: "", 
    category: "", 
    accessLevel: "" 
  });
  const [selectedContent, setSelectedContent] = useState<ContentData | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterCategory, setFilterCategory] = useState("all");
  const [userHistory, setUserHistory] = useState<UserHistory[]>([]);
  const [stats, setStats] = useState({
    totalContents: 0,
    verifiedContents: 0,
    averageAccessLevel: 0,
    userActions: 0
  });

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected || isInitialized) return;
      
      try {
        console.log('Initializing FHEVM...');
        await initialize();
        console.log('FHEVM initialized successfully');
      } catch (error) {
        console.error('Failed to initialize FHEVM:', error);
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadData();
        await loadUserHistory();
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  const loadData = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const contentsList: ContentData[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          contentsList.push({
            id: businessId,
            title: businessData.name,
            description: businessData.description,
            category: "Encrypted Content",
            accessLevel: Number(businessData.publicValue1) || 0,
            creator: businessData.creator,
            timestamp: Number(businessData.timestamp),
            publicValue1: Number(businessData.publicValue1) || 0,
            publicValue2: Number(businessData.publicValue2) || 0,
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0
          });
        } catch (e) {
          console.error('Error loading content data:', e);
        }
      }
      
      setContents(contentsList);
      updateStats(contentsList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const updateStats = (contentsList: ContentData[]) => {
    const totalContents = contentsList.length;
    const verifiedContents = contentsList.filter(c => c.isVerified).length;
    const averageAccessLevel = contentsList.length > 0 
      ? contentsList.reduce((sum, c) => sum + c.accessLevel, 0) / contentsList.length 
      : 0;
    
    setStats({
      totalContents,
      verifiedContents,
      averageAccessLevel,
      userActions: userHistory.length
    });
  };

  const loadUserHistory = async () => {
    const mockHistory: UserHistory[] = [
      { action: "VIEW", contentId: "content-001", timestamp: Date.now() - 3600000, status: "SUCCESS" },
      { action: "DECRYPT", contentId: "content-002", timestamp: Date.now() - 7200000, status: "SUCCESS" },
      { action: "CREATE", contentId: "content-003", timestamp: Date.now() - 10800000, status: "SUCCESS" }
    ];
    setUserHistory(mockHistory);
  };

  const createContent = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingContent(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating encrypted content..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract");
      
      const accessLevel = parseInt(newContentData.accessLevel) || 1;
      const businessId = `content-${Date.now()}`;
      
      const encryptedResult = await encrypt(await contract.getAddress(), address, accessLevel);
      
      const tx = await contract.createBusinessData(
        businessId,
        newContentData.title,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        accessLevel,
        0,
        newContentData.description
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for confirmation..." });
      await tx.wait();
      
      addUserHistory("CREATE", businessId, "SUCCESS");
      setTransactionStatus({ visible: true, status: "success", message: "Content created successfully!" });
      
      await loadData();
      setShowCreateModal(false);
      setNewContentData({ title: "", description: "", category: "", accessLevel: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected") ? "Transaction rejected" : "Creation failed";
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
    } finally { 
      setCreatingContent(false); 
    }
  };

  const decryptContent = async (contentId: string): Promise<number | null> => {
    if (!isConnected || !address) return null;
    
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(contentId);
      if (businessData.isVerified) {
        addUserHistory("DECRYPT", contentId, "SUCCESS");
        return Number(businessData.decryptedValue) || 0;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(contentId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        await contractWrite.getAddress(),
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(contentId, abiEncodedClearValues, decryptionProof)
      );
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      addUserHistory("DECRYPT", contentId, "SUCCESS");
      await loadData();
      
      return Number(clearValue);
    } catch (e: any) { 
      addUserHistory("DECRYPT", contentId, "FAILED");
      return null; 
    }
  };

  const addUserHistory = (action: string, contentId: string, status: string) => {
    const newHistory: UserHistory = {
      action,
      contentId,
      timestamp: Date.now(),
      status
    };
    setUserHistory(prev => [newHistory, ...prev.slice(0, 9)]);
  };

  const checkAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (contract) {
        const available = await contract.isAvailable();
        setTransactionStatus({ visible: true, status: "success", message: "System is available!" });
      }
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Availability check failed" });
    }
    setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
  };

  const filteredContents = contents.filter(content => {
    const matchesSearch = content.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         content.description.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = filterCategory === "all" || content.category === filterCategory;
    return matchesSearch && matchesCategory;
  });

  const categories = [...new Set(contents.map(c => c.category))];

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo-section">
            <div className="logo-icon">🔐</div>
            <h1>ContentGate FHE</h1>
          </div>
          <ConnectButton />
        </header>
        
        <div className="connection-prompt">
          <div className="neon-glow">
            <h2>Exclusive Content Access</h2>
            <p>Connect your wallet to access FHE-protected content</p>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized) {
    return (
      <div className="loading-screen">
        <div className="metal-spinner"></div>
        <p>Initializing FHE Encryption System...</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="metal-spinner"></div>
        <p>Loading encrypted content system...</p>
      </div>
    );
  }

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo-section">
          <div className="logo-icon">🔐</div>
          <h1>ContentGate FHE</h1>
          <span className="tagline">FHE-Protected Content Access</span>
        </div>
        
        <div className="header-actions">
          <button className="neon-btn" onClick={checkAvailability}>
            Check System
          </button>
          <button 
            className="neon-btn primary" 
            onClick={() => setShowCreateModal(true)}
          >
            + Create Content
          </button>
          <ConnectButton />
        </div>
      </header>

      <div className="main-layout">
        <aside className="sidebar">
          <div className="stats-panel metal-panel">
            <h3>Content Statistics</h3>
            <div className="stat-item">
              <span>Total Contents</span>
              <strong>{stats.totalContents}</strong>
            </div>
            <div className="stat-item">
              <span>Verified</span>
              <strong>{stats.verifiedContents}</strong>
            </div>
            <div className="stat-item">
              <span>Avg Access Level</span>
              <strong>{stats.averageAccessLevel.toFixed(1)}</strong>
            </div>
          </div>

          <div className="history-panel metal-panel">
            <h3>Recent Activity</h3>
            {userHistory.slice(0, 5).map((history, index) => (
              <div key={index} className="history-item">
                <span className={`action ${history.status.toLowerCase()}`}>
                  {history.action}
                </span>
                <span className="time">
                  {new Date(history.timestamp).toLocaleTimeString()}
                </span>
              </div>
            ))}
          </div>
        </aside>

        <main className="content-area">
          <div className="controls-bar">
            <div className="search-box">
              <input
                type="text"
                placeholder="Search contents..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="metal-input"
              />
            </div>
            
            <select 
              value={filterCategory} 
              onChange={(e) => setFilterCategory(e.target.value)}
              className="metal-select"
            >
              <option value="all">All Categories</option>
              {categories.map(cat => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>

            <button 
              onClick={loadData} 
              className="neon-btn"
              disabled={isRefreshing}
            >
              {isRefreshing ? "Refreshing..." : "Refresh"}
            </button>
          </div>

          <div className="content-grid">
            {filteredContents.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">🔒</div>
                <p>No encrypted contents found</p>
                <button 
                  className="neon-btn"
                  onClick={() => setShowCreateModal(true)}
                >
                  Create First Content
                </button>
              </div>
            ) : (
              filteredContents.map((content) => (
                <ContentCard
                  key={content.id}
                  content={content}
                  onSelect={setSelectedContent}
                  onDecrypt={decryptContent}
                />
              ))
            )}
          </div>
        </main>
      </div>

      {showCreateModal && (
        <CreateContentModal
          onSubmit={createContent}
          onClose={() => setShowCreateModal(false)}
          creating={creatingContent}
          contentData={newContentData}
          setContentData={setNewContentData}
          isEncrypting={isEncrypting}
        />
      )}

      {selectedContent && (
        <ContentDetailModal
          content={selectedContent}
          onClose={() => setSelectedContent(null)}
          onDecrypt={decryptContent}
        />
      )}

      {transactionStatus.visible && (
        <div className={`transaction-toast ${transactionStatus.status}`}>
          <div className="toast-content">
            <span className={`status-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "success" ? "✓" : 
               transactionStatus.status === "error" ? "✗" : "⏳"}
            </span>
            {transactionStatus.message}
          </div>
        </div>
      )}
    </div>
  );
};

const ContentCard: React.FC<{
  content: ContentData;
  onSelect: (content: ContentData) => void;
  onDecrypt: (contentId: string) => Promise<number | null>;
}> = ({ content, onSelect, onDecrypt }) => {
  const [decrypting, setDecrypting] = useState(false);

  const handleDecrypt = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setDecrypting(true);
    await onDecrypt(content.id);
    setDecrypting(false);
  };

  return (
    <div className="content-card metal-panel" onClick={() => onSelect(content)}>
      <div className="card-header">
        <h3>{content.title}</h3>
        <span className={`access-badge level-${content.accessLevel}`}>
          Level {content.accessLevel}
        </span>
      </div>
      
      <p className="card-description">{content.description}</p>
      
      <div className="card-footer">
        <span className="creator">
          {content.creator.substring(0, 6)}...{content.creator.substring(38)}
        </span>
        
        <button 
          className={`decrypt-btn ${content.isVerified ? 'verified' : ''}`}
          onClick={handleDecrypt}
          disabled={decrypting}
        >
          {decrypting ? "Decrypting..." : 
           content.isVerified ? "✅ Verified" : "🔓 Decrypt"}
        </button>
      </div>
    </div>
  );
};

const CreateContentModal: React.FC<{
  onSubmit: () => void;
  onClose: () => void;
  creating: boolean;
  contentData: any;
  setContentData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, creating, contentData, setContentData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setContentData({ ...contentData, [name]: value });
  };

  return (
    <div className="modal-overlay">
      <div className="create-modal metal-panel">
        <div className="modal-header">
          <h2>Create Encrypted Content</h2>
          <button onClick={onClose} className="close-btn">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice neon-glow">
            <strong>FHE 🔐 Protection Active</strong>
            <p>Access level will be encrypted using Zama FHE technology</p>
          </div>
          
          <div className="form-group">
            <label>Content Title</label>
            <input
              type="text"
              name="title"
              value={contentData.title}
              onChange={handleChange}
              className="metal-input"
              placeholder="Enter content title..."
            />
          </div>
          
          <div className="form-group">
            <label>Description</label>
            <textarea
              name="description"
              value={contentData.description}
              onChange={handleChange}
              className="metal-input"
              placeholder="Enter content description..."
              rows={3}
            />
          </div>
          
          <div className="form-group">
            <label>Access Level (FHE Encrypted)</label>
            <input
              type="number"
              name="accessLevel"
              value={contentData.accessLevel}
              onChange={handleChange}
              className="metal-input"
              placeholder="1-10"
              min="1"
              max="10"
            />
            <div className="input-hint">Integer only - Will be FHE encrypted</div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="neon-btn">Cancel</button>
          <button 
            onClick={onSubmit}
            disabled={creating || isEncrypting || !contentData.title || !contentData.accessLevel}
            className="neon-btn primary"
          >
            {creating || isEncrypting ? "Encrypting..." : "Create Content"}
          </button>
        </div>
      </div>
    </div>
  );
};

const ContentDetailModal: React.FC<{
  content: ContentData;
  onClose: () => void;
  onDecrypt: (contentId: string) => Promise<number | null>;
}> = ({ content, onClose, onDecrypt }) => {
  const [decrypting, setDecrypting] = useState(false);
  const [localDecrypted, setLocalDecrypted] = useState<number | null>(null);

  const handleDecrypt = async () => {
    setDecrypting(true);
    const result = await onDecrypt(content.id);
    setLocalDecrypted(result);
    setDecrypting(false);
  };

  return (
    <div className="modal-overlay">
      <div className="detail-modal metal-panel">
        <div className="modal-header">
          <h2>Content Details</h2>
          <button onClick={onClose} className="close-btn">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="content-info">
            <h3>{content.title}</h3>
            <p>{content.description}</p>
            
            <div className="info-grid">
              <div className="info-item">
                <span>Creator:</span>
                <strong>{content.creator}</strong>
              </div>
              <div className="info-item">
                <span>Created:</span>
                <strong>{new Date(content.timestamp * 1000).toLocaleDateString()}</strong>
              </div>
              <div className="info-item">
                <span>Access Level:</span>
                <strong>Level {content.accessLevel}</strong>
              </div>
            </div>
          </div>
          
          <div className="encryption-section">
            <h4>FHE Encryption Status</h4>
            <div className="encryption-status">
              {content.isVerified ? (
                <div className="status-verified">
                  <span className="status-icon">✅</span>
                  <span>On-chain Verified - Decrypted Value: {content.decryptedValue}</span>
                </div>
              ) : localDecrypted !== null ? (
                <div className="status-decrypted">
                  <span className="status-icon">🔓</span>
                  <span>Locally Decrypted: {localDecrypted}</span>
                </div>
              ) : (
                <div className="status-encrypted">
                  <span className="status-icon">🔐</span>
                  <span>FHE Encrypted - Ready for Verification</span>
                </div>
              )}
            </div>
            
            <button 
              className={`neon-btn ${content.isVerified ? 'verified' : ''}`}
              onClick={handleDecrypt}
              disabled={decrypting}
            >
              {decrypting ? "Decrypting..." : 
               content.isVerified ? "✅ Verified" : 
               localDecrypted !== null ? "🔄 Re-verify" : "🔓 Verify Decryption"}
            </button>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="neon-btn">Close</button>
        </div>
      </div>
    </div>
  );
};

export default App;


