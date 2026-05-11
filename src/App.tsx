/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { auth, db, googleProvider } from './firebase';
import { signInWithPopup, signOut, onAuthStateChanged, User } from 'firebase/auth';
import { collection, query, orderBy, onSnapshot, addDoc, serverTimestamp, where, Timestamp, deleteDoc, doc, updateDoc } from 'firebase/firestore';
import { PRODUCTS, formatCurrency } from './constants';
import { 
  AlertCircle, 
  CheckCircle2, 
  TrendingUp, 
  Package, 
  DollarSign, 
  History, 
  LogOut, 
  LogIn, 
  Camera, 
  Upload, 
  Loader2, 
  X,
  ScanLine,
  Trash2,
  Search,
  CheckSquare,
  Square,
  CreditCard,
  Copy,
  Star
} from 'lucide-react';
import { cn, handleFirestoreError, OperationType } from './lib/utils';

interface SaleRecord {
  id: string;
  itemName: string;
  originalPrice: number;
  soldPrice: number;
  profit: number;
  createdAt: any;
  userId: string;
  userEmail: string;
  trackingNumber?: string;
  isPaid?: boolean;
  isYellow?: boolean;
}

const ADMIN_EMAIL = import.meta.env.VITE_ADMIN_EMAIL || "yamannewtab@gmail.com";

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [sales, setSales] = useState<SaleRecord[]>([]);
  const [selectedProduct, setSelectedProduct] = useState(PRODUCTS[0].name);
  const [soldPrice, setSoldPrice] = useState<string>('');
  const [trackingNumber, setTrackingNumber] = useState<string>('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [saveLoading, setSaveLoading] = useState(false);
  const [status, setStatus] = useState<{ type: 'error' | 'success', msg: string } | null>(null);
  const [activeSaleTab, setActiveSaleTab] = useState<'single' | 'list' | 'multi'>('single');
  const [multiTrackingNumber, setMultiTrackingNumber] = useState('');
  const [multiItems, setMultiItems] = useState<{productName: string, soldPrice: string}[]>([{productName: PRODUCTS[0].name, soldPrice: ''}]);
  const [listText, setListText] = useState<string>('');
  const [isAnalyzingList, setIsAnalyzingList] = useState(false);
  const [includeDuplicates, setIncludeDuplicates] = useState(false);
  
  interface PendingSale {
    itemName: string;
    originalPrice: number;
    soldPrice: number;
    profit: number;
    trackingNumber: string;
  }
  const [pendingBulkSales, setPendingBulkSales] = useState<{ toBeAdded: PendingSale[], toBeSkipped: PendingSale[] } | null>(null);
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [salesLoading, setSalesLoading] = useState(true);
  const [deleteLoading, setDeleteLoading] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [timeFilter, setTimeFilter] = useState<'all' | 'today' | 'week' | 'month'>('today');
  const [paymentFilter, setPaymentFilter] = useState<'all' | 'unpaid' | 'paid'>('all');
  const [dashboardTab, setDashboardTab] = useState<'ledger' | 'paymentHistory'>('ledger');
  const [batchEditMode, setBatchEditMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchSoldPrice, setBatchSoldPrice] = useState('');

  const [searchQuery, setSearchQuery] = useState('');
  const [payModalState, setPayModalState] = useState<'closed' | 'input' | 'confirm'>('closed');
  const [payCount, setPayCount] = useState<string>('');
  const [selectedToPay, setSelectedToPay] = useState<SaleRecord[]>([]);
  const [payProcessing, setPayProcessing] = useState(false);

  // Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // Sales Listener
  useEffect(() => {
    if (!user || user.email !== ADMIN_EMAIL) {
      setSalesLoading(false);
      return;
    }

    setSalesLoading(true);
    // Remove orderBy from the DB query to avoid indexing issues
    const q = query(collection(db, 'sales'));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as SaleRecord[];
      
      // Sort in memory instead of in the DB query
      const sortedData = data.sort((a, b) => {
        const timeA = a.createdAt?.toMillis?.() || 0;
        const timeB = b.createdAt?.toMillis?.() || 0;
        return timeB - timeA;
      });
      
      setSales(sortedData);
      setSalesLoading(false);
    }, (error) => {
      console.error('Sales listener error:', error);
      setStatus({ type: 'error', msg: `Failed to load sales: ${error.message}` });
      setSalesLoading(false);
    });

    return () => unsubscribe();
  }, [user]);

  const login = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      console.error(err);
      setStatus({ type: 'error', msg: 'Login failed' });
    }
  };

  const logout = () => signOut(auth);

  const handleManualPriceChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.replace(/\D/g, '');
    setSoldPrice(value);
  };

  const currentProduct = PRODUCTS.find(p => p.name === selectedProduct) || PRODUCTS[0];
  const parsedSoldPrice = parseInt(soldPrice.replace(/\D/g, ''), 10) || 0;
  const currentProfit = parsedSoldPrice > 0 ? parsedSoldPrice - currentProduct.originalPrice : 0;

  const filteredSales = sales.filter(s => {
    // First apply search filter
    const searchLower = searchQuery.toLowerCase().trim();
    const formattedDate = new Date(s.createdAt?.toMillis?.() || Date.now()).toLocaleDateString('en-GB');
    const matchesSearch = !searchLower || 
      s.itemName.toLowerCase().includes(searchLower) ||
      (s.trackingNumber && s.trackingNumber.toLowerCase().includes(searchLower)) ||
      formattedDate.includes(searchLower);

    if (!matchesSearch) return false;

    // Apply payment filter
    if (dashboardTab === 'ledger') {
        if (paymentFilter === 'unpaid' && s.isPaid) return false;
        if (paymentFilter === 'paid' && !s.isPaid) return false;
    } else if (dashboardTab === 'paymentHistory' && !s.isPaid) {
        return false;
    }

    // Then apply time filter
    if (timeFilter === 'all') return true;
    
    // createdAt could be a Firestore Timestamp, so convert to Date. 
    // If pending from local write, it might be null, so fallback to Date.now()
    const saleDate = new Date(s.createdAt?.toMillis?.() || Date.now());
    const now = new Date();
    
    if (timeFilter === 'today') {
      return saleDate.getDate() === now.getDate() &&
             saleDate.getMonth() === now.getMonth() &&
             saleDate.getFullYear() === now.getFullYear();
    }
    
    if (timeFilter === 'week') {
      // Last 7 days
      const diffMs = now.getTime() - saleDate.getTime();
      return diffMs <= 7 * 24 * 60 * 60 * 1000;
    }
    
    if (timeFilter === 'month') {
      return saleDate.getMonth() === now.getMonth() &&
             saleDate.getFullYear() === now.getFullYear();
    }
    
    return true;
  });

  const applyBatchEdit = async () => {
    const newPrice = parseInt(batchSoldPrice, 10);
    if (isNaN(newPrice) || newPrice <= 0 || selectedIds.size === 0) return;
    
    setSaveLoading(true);
    let count = 0;
    try {
        for (const id of selectedIds) {
            const sale = sales.find(s => s.id === id);
            if (!sale) continue;
            
            const cProfit = newPrice - sale.originalPrice;
            await updateDoc(doc(db, 'sales', id), {
                soldPrice: newPrice,
                profit: cProfit
            });
            count++;
        }
        setStatus({ type: 'success', msg: `Updated ${count} items` });
        setSelectedIds(new Set());
        setBatchSoldPrice('');
        setBatchEditMode(false);
        setTimeout(() => setStatus(null), 3000);
    } catch (err) {
        setStatus({ type: 'error', msg: 'Failed to batch edit' });
    } finally {
        setSaveLoading(false);
    }
  };

  const totalProfit = filteredSales.reduce((sum, s) => sum + s.profit, 0);
  const totalRevenue = filteredSales.reduce((sum, s) => sum + s.soldPrice, 0);
  const totalToPay = filteredSales.filter(s => !s.isPaid).reduce((sum, s) => sum + s.originalPrice, 0);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsAnalyzing(true);
    setStatus(null);

    try {
      const reader = new FileReader();
      const base64Promise = new Promise<string>((resolve) => {
        reader.onload = () => resolve(reader.result as string);
        reader.readAsDataURL(file);
      });

      const base64Data = await base64Promise;
      const base64String = base64Data.split(',')[1];
      const token = await auth.currentUser?.getIdToken();

      const response = await fetch('/api/analyze-receipt', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          base64String: base64String,
          fileType: file.type,
          productsList: PRODUCTS.map(p => p.name).join(', ') 
        })
      });

      if (!response.ok) {
        throw new Error("Server failed to process image");
      }

      const result = await response.json();

      if (result.items && result.items.length > 0) {
        if (result.items.length === 1) {
          const item = result.items[0];
          if (item.itemName) setSelectedProduct(item.itemName);
          if (item.soldPrice) setSoldPrice(item.soldPrice.toString());
          if (item.trackingNumber) setTrackingNumber(item.trackingNumber);
          setStatus({ type: 'success', msg: 'Screenshot analyzed! Review and Sync.' });
        } else {
          // Process multiple items automatically
          let processed = 0;
          let skipped = 0;
          const currentTrackingNumbers = new Set(sales.map(s => s.trackingNumber?.toLowerCase()).filter(Boolean));

          for (const item of result.items) {
             const matchedProduct = PRODUCTS.find(p => p.name === item.itemName) || PRODUCTS[0];
             const pSoldPrice = item.soldPrice || 0;
             const cProfit = pSoldPrice > 0 ? pSoldPrice - matchedProduct.originalPrice : 0;
             const tNum = item.trackingNumber ? item.trackingNumber.trim() : '';

             if (pSoldPrice <= 0) continue;

             if (tNum !== '') {
                const lowerTNum = tNum.toLowerCase();
                if (currentTrackingNumbers.has(lowerTNum)) {
                  skipped++;
                  continue;
                }
                currentTrackingNumbers.add(lowerTNum); // Block duplicates in same batch
             }
             
             await addDoc(collection(db, 'sales'), {
                itemName: matchedProduct.name,
                originalPrice: matchedProduct.originalPrice,
                soldPrice: pSoldPrice,
                profit: cProfit,
                trackingNumber: tNum,
                createdAt: serverTimestamp(),
                userId: user?.uid || '',
                userEmail: user?.email || '',
                isPaid: false
             });
             processed++;
          }
          
          setStatus({ 
            type: 'success', 
            msg: `Bulk Scan Complete: Stored ${processed} items! ${skipped > 0 ? `(${skipped} duplicates skipped)` : ''}` 
          });
          setTimeout(() => setStatus(null), 5000);
        }
      } else {
        setStatus({ type: 'error', msg: 'No items recognized.' });
      }
    } catch (err) {
      console.error(err);
      setStatus({ type: 'error', msg: 'Analysis failed. Please try manual entry.' });
    } finally {
      setIsAnalyzing(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleListSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || user.email !== ADMIN_EMAIL) return;
    if (!listText.trim()) return;

    setIsAnalyzingList(true);
    setStatus(null);

    try {
      const token = await auth.currentUser?.getIdToken();
      const response = await fetch('/api/analyze-list', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          textList: listText,
          productsList: PRODUCTS.map(p => p.name).join(', ') 
        })
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || "Server failed to process text list");
      }

      const result = await response.json();

      if (result.items && result.items.length > 0) {
        let processed = 0;
        let skipped = 0;
        const currentKeys = new Set(sales.filter(s => s.trackingNumber).map(s => `${s.trackingNumber?.toLowerCase().trim()}|${s.itemName}`));

        const toBeAdded: PendingSale[] = [];
        const toBeSkipped: PendingSale[] = [];

        for (const item of result.items) {
          const matchedProduct = PRODUCTS.find(p => p.name === item.itemName) || PRODUCTS[0];
          const pSoldPrice = item.soldPrice || 0;
          const cProfit = pSoldPrice > 0 ? pSoldPrice - matchedProduct.originalPrice : -matchedProduct.originalPrice; 
          const tNum = item.trackingNumber ? item.trackingNumber.trim() : '';

          const key = `${tNum.toLowerCase()}|${matchedProduct.name}`;
          const currentSale: PendingSale = {
            itemName: matchedProduct.name,
            originalPrice: matchedProduct.originalPrice,
            soldPrice: pSoldPrice,
            profit: cProfit,
            trackingNumber: tNum
          };

          if (tNum !== '' && currentKeys.has(key)) {
            toBeSkipped.push(currentSale);
          } else {
            if (tNum !== '') {
              currentKeys.add(key); // block duplicates within the same list
            }
            toBeAdded.push(currentSale);
          }
        }
        
        setPendingBulkSales({ toBeAdded, toBeSkipped });
      } else {
        setStatus({ type: 'error', msg: 'No valid items extracted by AI.' });
      }
    } catch (err: any) {
      console.error(err);
      setStatus({ type: 'error', msg: err?.message || 'Failed to process list.' });
    } finally {
      setIsAnalyzingList(false);
    }
  };

  const confirmBulkSales = async () => {
    if (!pendingBulkSales || !user) return;
    setSaveLoading(true);
    let processed = 0;
    try {
      const allToAdd = includeDuplicates 
        ? [...pendingBulkSales.toBeAdded, ...pendingBulkSales.toBeSkipped]
        : pendingBulkSales.toBeAdded;

      for (const item of allToAdd) {
        await addDoc(collection(db, 'sales'), {
          ...item,
          createdAt: serverTimestamp(),
          userId: user.uid,
          userEmail: user.email,
          isPaid: false
        });
        processed++;
      }
      setStatus({ 
        type: 'success', 
        msg: `Successfully added ${processed} items! ${(!includeDuplicates && pendingBulkSales.toBeSkipped.length > 0) ? '(' + pendingBulkSales.toBeSkipped.length + ' skipped)' : ''}` 
      });
      setTimeout(() => setStatus(null), 5000);
    } catch (e: any) {
      console.error(e);
      setStatus({ type: 'error', msg: 'Failed to insert some bulk records.' });
    }
    setSaveLoading(false);
    setPendingBulkSales(null);
    setIncludeDuplicates(false);
    setListText('');
  };

  const saveMultiSale = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || user.email !== ADMIN_EMAIL) return;
    if (multiTrackingNumber.trim() === '') {
      setStatus({ type: 'error', msg: 'Tracking code is required for multi-item' });
      return;
    }

    const tnum = multiTrackingNumber.trim().toLowerCase();

    // basic validation
    const validItems = multiItems.filter(item => {
      const spv = parseInt(item.soldPrice.replace(/\D/g, ''), 10) || 0;
      return spv > 0;
    });

    if (validItems.length === 0) {
      setStatus({ type: 'error', msg: 'At least one item needs a valid sold price' });
      return;
    }

    // Checking for duplicates combinations
    for (const item of validItems) {
      const isDuplicate = sales.some(
        s => s.trackingNumber?.toLowerCase() === tnum && s.itemName === item.productName
      );
      if (isDuplicate && !includeDuplicates) {
        setStatus({ type: 'error', msg: `Duplicate found for product ${item.productName} under tracking ${multiTrackingNumber}.` });
        return;
      }
    }

    setSaveLoading(true);
    let count = 0;
    try {
      for (const item of validItems) {
        const prodMatch = PRODUCTS.find(p => p.name === item.productName) || PRODUCTS[0];
        const spv = parseInt(item.soldPrice.replace(/\D/g, ''), 10) || 0;
        const cProfit = spv - prodMatch.originalPrice;

        await addDoc(collection(db, 'sales'), {
          itemName: prodMatch.name,
          originalPrice: prodMatch.originalPrice,
          soldPrice: spv,
          profit: cProfit,
          trackingNumber: multiTrackingNumber.trim(),
          createdAt: serverTimestamp(),
          userId: user.uid,
          userEmail: user.email,
          isPaid: false
        });
        count++;
      }
      setMultiTrackingNumber('');
      setMultiItems([{productName: PRODUCTS[0].name, soldPrice: ''}]);
      setIncludeDuplicates(false);
      setStatus({ type: 'success', msg: `Saved ${count} items successfully` });
      setTimeout(() => setStatus(null), 3000);
    } catch (err: any) {
      console.error('Save error:', err);
      setStatus({ type: 'error', msg: `Save failed: ${err.message || 'Unknown error'}` });
    } finally {
      setSaveLoading(false);
    }
  };

  const saveSale = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || user.email !== ADMIN_EMAIL) return;
    if (parsedSoldPrice <= 0) return;

    if (trackingNumber.trim() !== '') {
      const isDuplicate = sales.some(
        s => s.trackingNumber?.toLowerCase() === trackingNumber.trim().toLowerCase() 
             && s.itemName === selectedProduct
      );
      if (isDuplicate) {
        setStatus({ type: 'error', msg: 'This Tracking code and Product combination is already stored!' });
        return;
      }
    }

    setSaveLoading(true);
    try {
      await addDoc(collection(db, 'sales'), {
        itemName: currentProduct.name,
        originalPrice: currentProduct.originalPrice,
        soldPrice: parsedSoldPrice,
        profit: currentProfit,
        trackingNumber: trackingNumber.trim(),
        createdAt: serverTimestamp(),
        userId: user.uid,
        userEmail: user.email,
        isPaid: false
      });
      setSoldPrice('');
      setTrackingNumber('');
      setStatus({ type: 'success', msg: 'Sale recorded' });
      setTimeout(() => setStatus(null), 3000);
    } catch (err: any) {
      console.error('Save error:', err);
      setStatus({ type: 'error', msg: `Save failed: ${err.message || 'Unknown error'}` });
    } finally {
      setSaveLoading(false);
    }
  };

  const deleteSale = async (id: string) => {
    if (!window.confirm('Delete this record forever?')) return;
    
    setDeleteLoading(id);
    try {
      await deleteDoc(doc(db, 'sales', id));
      setStatus({ type: 'success', msg: 'Record deleted' });
      setTimeout(() => setStatus(null), 2000);
    } catch (err: any) {
      console.error('Delete error:', err);
      setStatus({ type: 'error', msg: 'Delete failed' });
    } finally {
      setDeleteLoading(null);
    }
  };

  const togglePaidStatus = async (id: string, currentStatus: boolean | undefined) => {
    setActionLoading(id);
    try {
      await updateDoc(doc(db, 'sales', id), { isPaid: !currentStatus });
    } catch (err: any) {
      console.error('Update error:', err);
      setStatus({ type: 'error', msg: 'Failed to update paid status' });
    } finally {
      setActionLoading(null);
    }
  };

  const toggleYellowStatus = async (id: string, currentStatus: boolean | undefined) => {
    setActionLoading(id);
    try {
      await updateDoc(doc(db, 'sales', id), { isYellow: !currentStatus });
    } catch (err: any) {
      console.error('Update error:', err);
      setStatus({ type: 'error', msg: 'Failed to update yellow status' });
    } finally {
      setActionLoading(null);
    }
  };

  const startPaymentFlow = () => {
    setPayCount('');
    setSelectedToPay([]);
    setPayModalState('input');
  };

  const generatePaymentList = () => {
    const count = parseInt(payCount, 10);
    if (isNaN(count) || count <= 0) return;
    const unpaid = sales.filter(s => !s.isPaid);
    if (count > unpaid.length) {
      alert(`You only have ${unpaid.length} unpaid items!`);
      return;
    }
    const shuffled = [...unpaid].sort((a,b) => {
        const timeA = a.createdAt?.toMillis?.() || 0;
        const timeB = b.createdAt?.toMillis?.() || 0;
        return timeA - timeB; // Oldest first
    });
    setSelectedToPay(shuffled.slice(0, count));
    setPayModalState('confirm');
  };

  const confirmPayment = async () => {
    setPayProcessing(true);
    try {
      for (const item of selectedToPay) {
        await updateDoc(doc(db, 'sales', item.id), { isPaid: true });
      }
      setPayModalState('closed');
      setSelectedToPay([]);
    } catch (err) {
      console.error(err);
      alert('Error updating payment');
    } finally {
      setPayProcessing(false);
    }
  };

  const copyPaymentList = () => {
    const text = selectedToPay.map(s => `${s.itemName} - ${s.trackingNumber || 'No Code'} - ${formatCurrency(s.originalPrice)}`).join('\n');
    navigator.clipboard.writeText(text);
    alert('Copied to clipboard! Each product is on one line.');
  };

  const copyAllUnpaidOrders = () => {
    const unpaid = sales.filter(s => !s.isPaid);
    const text = unpaid.map((s, index) => `${index + 1}. ${s.itemName} | ${s.trackingNumber || 'No Code'}`).join('\n');
    navigator.clipboard.writeText(text);
    alert('Copied all unpaid orders to clipboard!');
  };

  const copySinglePayment = (sale: SaleRecord) => {
    const text = `${sale.itemName} | ${sale.trackingNumber || 'No Code'}`;
    navigator.clipboard.writeText(text);
    alert('Copied to clipboard!');
  };

  // --- BULK IMPORT UTILITY ---
  const handleBulkResetAndImport = async () => {
    if (!user || user.email !== ADMIN_EMAIL) return;
    setStatus({ type: 'success', msg: 'Starting bulk import...' });
    try {
      // 1. Delete all current sales
      for (const sale of sales) {
        await deleteDoc(doc(db, 'sales', sale.id));
      }

      // 2. Insert new sales
      const rawData = `FAJ-360QB\tTESTTRACKING001
FAJ-360BW\tTESTTRACKING002
WF-14GB-D\tTESTTRACKING003`;

      const lines = rawData.split('\n');
      for (const line of lines) {
        const [itemNameRaw, trackingRaw] = line.split('\t');
        if (!itemNameRaw || !trackingRaw) continue;
        
        let normalizedName = itemNameRaw.trim();
        // Simple mapping based on your data formats
        if (normalizedName.toLowerCase() === 'hitam') normalizedName = 'AS-S016 BB'; // Assuming 'hitam' maps here
        else if (normalizedName.toLowerCase() === 'grey') normalizedName = 'AS-S016 GB'; // Assuming 'grey' maps here
        else if (normalizedName.toLowerCase() === 'three') normalizedName = PRODUCTS[0].name; // Defaulting unknown 'three'
        else if (normalizedName === 'WF-14GB-D') normalizedName = 'WF-14 GB/D';
        else if (normalizedName === 'WF-14FG-D') normalizedName = 'WF-14 FG/D';
        else if (normalizedName === 'WR 02TTGW') normalizedName = 'WR-02 TTGW';
        else if (normalizedName === 'WF 14FG') normalizedName = 'WF-14  FG';
        else if (normalizedName === 'WF 14GB') normalizedName = 'WF-14  GB';
        
        // Find matched product to get correct original price
        let matchedProduct = PRODUCTS.find(p => p.name === normalizedName) || 
                             PRODUCTS.find(p => p.name.replace(/[-\s\/]/g, '').toLowerCase() === normalizedName.replace(/[-\s\/]/g, '').toLowerCase());
                             
        if (!matchedProduct) {
          // Fallback to exactly what was in the import if no product found
          matchedProduct = { name: itemNameRaw.trim(), originalPrice: 0 };
        }

        await addDoc(collection(db, 'sales'), {
          itemName: matchedProduct.name,
          originalPrice: matchedProduct.originalPrice,
          soldPrice: 0, // Not provided in text dump
          profit: 0 - matchedProduct.originalPrice, // Because sold price is 0
          trackingNumber: trackingRaw.trim(),
          createdAt: serverTimestamp(),
          userId: user.uid,
          userEmail: user.email,
          isPaid: false
        });
      }
      setStatus({ type: 'success', msg: 'Data reset and imported successfully!' });
    } catch (err) {
      console.error(err);
      setStatus({ type: 'error', msg: 'Import failed: ' + String(err) });
    }
  };
  // --- END BULK IMPORT UTILITY ---

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center p-6 bg-[radial-gradient(circle_at_top_right,#f0f7ff,transparent),radial-gradient(circle_at_bottom_left,#fff4f4,transparent)]">
        <div className="max-w-md w-full text-center space-y-8">
          <div className="inline-flex p-4 bg-white shadow-[0_8px_30px_rgb(0,0,0,0.04)] rounded-3xl">
            <TrendingUp className="w-12 h-12 text-blue-500" />
          </div>
          <div className="space-y-2">
            <h1 className="text-4xl font-extrabold tracking-tight text-gray-900">Profit Tracker</h1>
            <p className="text-gray-500 text-lg">Smart inventory management for admins.</p>
          </div>
          <button
            onClick={login}
            className="w-full flex items-center justify-center gap-3 bg-white border border-gray-200 text-gray-700 font-semibold py-4 px-6 rounded-2xl shadow-sm hover:shadow-md hover:bg-gray-50 transition-all group"
          >
            <img src="https://www.google.com/favicon.ico" className="w-5 h-5" alt="Google" />
            Sign in with Google
          </button>
        </div>
      </div>
    );
  }

  if (user.email !== ADMIN_EMAIL) {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center p-6">
        <AlertCircle className="w-16 h-16 text-red-500 mb-6" />
        <h1 className="text-2xl font-bold mb-2">Access Denied</h1>
        <p className="text-gray-500 text-center max-w-sm mb-8">
          This application is restricted to authorized administrative personnel only.
        </p>
        <button onClick={logout} className="text-blue-600 font-medium hover:underline">Sign out</button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#FDFDFF] text-slate-900 antialiased font-sans">
      {/* Dynamic Background Accents */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden -z-10">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-blue-50 blur-[120px] rounded-full opacity-60" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-emerald-50 blur-[120px] rounded-full opacity-60" />
      </div>

      <nav className="sticky top-0 z-50 bg-white/70 backdrop-blur-xl border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-20 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-blue-600 p-2.5 rounded-2xl shadow-lg shadow-blue-200">
              <TrendingUp className="w-5 h-5 text-white" />
            </div>
            <span className="text-xl font-bold tracking-tight bg-gradient-to-r from-blue-700 to-indigo-600 bg-clip-text text-transparent italic">
              Yamannewtab
            </span>
          </div>
          
          <div className="flex items-center gap-6">
            <div className="hidden sm:flex items-center gap-3">
              <img src={user.photoURL || ''} className="w-10 h-10 rounded-full border-2 border-white shadow-sm" alt="" />
              <div className="flex flex-col">
                <span className="text-sm font-bold text-gray-900 leading-none mb-1">{user.displayName}</span>
                <span 
                  onClick={handleBulkResetAndImport}
                  className="text-[10px] uppercase tracking-wider font-bold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded cursor-pointer hover:bg-blue-100"
                  title="Click to reset DB and bulk import data"
                >
                  Owner
                </span>
              </div>
            </div>
            <button onClick={logout} className="p-2 text-gray-400 hover:text-red-500 transition-colors">
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          
          {/* Dashboard Left */}
          <div className="lg:col-span-4 space-y-8">
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-white p-6 rounded-3xl shadow-[0_10px_30px_rgba(0,0,0,0.03)] border border-gray-50">
                  <p className="text-[10px] uppercase tracking-wider font-bold text-slate-400 mb-1">Paid Today</p>
                  <p className="text-3xl font-black text-emerald-600">{sales.filter(s => s.isPaid && new Date(s.createdAt?.toMillis?.() || Date.now()).toDateString() === new Date().toDateString()).length}</p>
              </div>
              <div className="bg-white p-6 rounded-3xl shadow-[0_10px_30px_rgba(0,0,0,0.03)] border border-gray-50">
                  <p className="text-[10px] uppercase tracking-wider font-bold text-slate-400 mb-1">Pending Unpaid</p>
                  <p className="text-3xl font-black text-amber-600">{sales.filter(s => !s.isPaid).length}</p>
              </div>
            </div>
            <section className="bg-white rounded-[32px] p-8 shadow-[0_20px_50px_rgba(0,0,0,0.03)] border border-gray-50">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-bold tracking-tight">New Sale</h2>
                <div className="flex gap-2">
                  <input 
                    type="file" 
                    id="screenshot" 
                    className="hidden" 
                    accept="image/*" 
                    onChange={handleFileUpload}
                    ref={fileInputRef}
                  />
                  <label 
                    htmlFor="screenshot"
                    className="flex items-center gap-2 px-3 py-1.5 bg-blue-50 text-blue-600 rounded-xl text-xs font-bold cursor-pointer hover:bg-blue-100 transition-all border border-blue-100"
                  >
                    {isAnalyzing ? <Loader2 className="w-3 h-3 animate-spin"/> : <ScanLine className="w-3 h-3"/>}
                    AI Scan
                  </label>
                </div>
              </div>

              {/* Tabs */}
              <div className="flex bg-gray-100 p-1 rounded-xl mb-6">
                <button
                  type="button"
                  onClick={() => {
                    setActiveSaleTab('single');
                    setPendingBulkSales(null);
                  }}
                  className={cn(
                    "flex-1 py-2 text-[10px] uppercase tracking-wider font-bold rounded-lg transition-all",
                    activeSaleTab === 'single' ? "bg-white text-gray-900 shadow" : "text-gray-500 hover:text-gray-700"
                  )}
                >
                  Single
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setActiveSaleTab('multi');
                    setPendingBulkSales(null);
                  }}
                  className={cn(
                    "flex-1 py-2 text-[10px] uppercase tracking-wider font-bold rounded-lg transition-all",
                    activeSaleTab === 'multi' ? "bg-white text-gray-900 shadow" : "text-gray-500 hover:text-gray-700"
                  )}
                >
                  Multi
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setActiveSaleTab('list');
                    setPendingBulkSales(null);
                  }}
                  className={cn(
                    "flex-1 py-2 text-[10px] uppercase tracking-wider font-bold rounded-lg transition-all",
                    activeSaleTab === 'list' ? "bg-white text-gray-900 shadow" : "text-gray-500 hover:text-gray-700"
                  )}
                >
                  List (AI)
                </button>
              </div>

              {activeSaleTab === 'single' ? (
                <form onSubmit={saveSale} className="space-y-6">
                  {/* ... existing single ... */}
                  <div className="space-y-2">
                    <label className="text-[11px] uppercase tracking-[2px] font-bold text-gray-400 ml-1">Select Item</label>
                    <select
                      value={selectedProduct}
                      onChange={(e) => setSelectedProduct(e.target.value)}
                      className="w-full bg-gray-50/50 border-none px-5 py-4 rounded-2xl focus:ring-2 focus:ring-blue-100 outline-none transition-all font-medium text-gray-700 appearance-none"
                    >
                      {PRODUCTS.map(p => <option key={p.name} value={p.name}>{p.name}</option>)}
                    </select>
                  </div>

                  <div className="p-5 bg-slate-50 rounded-2xl border border-dashed border-slate-200">
                    <span className="text-[10px] uppercase font-bold text-slate-400">Buying Cost</span>
                    <p className="text-xl font-bold text-slate-900 mt-1">{formatCurrency(currentProduct.originalPrice)}</p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-[11px] uppercase tracking-[2px] font-bold text-gray-400 ml-1">Selling Price</label>
                      <div className="relative">
                        <span className="absolute left-5 top-1/2 -translate-y-1/2 text-gray-400 font-bold">Rp</span>
                        <input
                          type="text"
                          value={soldPrice ? new Intl.NumberFormat('id-ID').format(parseInt(soldPrice,10)) : ''}
                          onChange={handleManualPriceChange}
                          placeholder="0"
                          className="w-full bg-blue-50/30 border-none pl-12 pr-5 py-4 rounded-2xl focus:ring-2 focus:ring-blue-100 outline-none transition-all font-bold text-xl text-blue-600"
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <label className="text-[11px] uppercase tracking-[2px] font-bold text-gray-400 ml-1">Tracking Code</label>
                      <div className="relative group">
                        <Search className="absolute left-5 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5 group-focus-within:text-blue-500 transition-colors" />
                        <input
                          type="text"
                          value={trackingNumber}
                          onChange={(e) => setTrackingNumber(e.target.value)}
                          placeholder="SPX123..."
                          className="w-full bg-slate-50/50 border-none pl-12 pr-5 py-4 rounded-2xl focus:ring-2 focus:ring-blue-100 outline-none transition-all font-medium text-gray-700"
                        />
                      </div>
                    </div>
                  </div>

                  {parsedSoldPrice > 0 && (
                    <div className={cn(
                      "p-6 rounded-2xl flex flex-col items-center justify-center text-center",
                      currentProfit >= 0 ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"
                    )}>
                      <span className="text-[10px] uppercase font-black tracking-widest leading-none mb-2 opacity-60">Estimated Profit</span>
                      <span className="text-3xl font-black">{currentProfit >= 0 ? '+' : ''}{formatCurrency(currentProfit)}</span>
                    </div>
                  )}

                  {status && (
                    <div className={cn(
                      "p-4 rounded-xl text-sm font-bold flex items-center gap-3 animate-in fade-in duration-300",
                      status.type === 'error' ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"
                    )}>
                      {status.type === 'error' ? <AlertCircle className="w-5 h-5"/> : <CheckCircle2 className="w-5 h-5"/>}
                      {status.msg}
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={saveLoading || parsedSoldPrice <= 0}
                    className="w-full bg-slate-900 text-white py-5 rounded-2xl font-bold uppercase tracking-[2px] hover:bg-black transition-all shadow-xl shadow-slate-200 disabled:opacity-30 disabled:shadow-none flex items-center justify-center gap-3"
                  >
                    {saveLoading ? <Loader2 className="w-5 h-5 animate-spin"/> : "Sync to Ledger"}
                  </button>
                </form>
              ) : activeSaleTab === 'multi' ? (
                <form onSubmit={saveMultiSale} className="space-y-6">
                  <div className="space-y-2">
                    <label className="text-[11px] uppercase tracking-[2px] font-bold text-gray-400 ml-1">Universal Tracking Code</label>
                    <div className="relative group">
                      <Search className="absolute left-5 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5 group-focus-within:text-blue-500 transition-colors" />
                      <input
                        type="text"
                        value={multiTrackingNumber}
                        onChange={(e) => setMultiTrackingNumber(e.target.value)}
                        placeholder="SPX123... (applies to all below)"
                        className="w-full bg-blue-50/50 border-none pl-12 pr-5 py-4 rounded-2xl focus:ring-2 focus:ring-blue-100 outline-none transition-all font-medium text-blue-900 placeholder:text-blue-300"
                      />
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div className="flex justify-between items-end">
                      <label className="text-[11px] uppercase tracking-[2px] font-bold text-gray-400 ml-1">Products in Bundle</label>
                      <button 
                        type="button" 
                        onClick={() => setMultiItems([...multiItems, {productName: PRODUCTS[0].name, soldPrice: ''}])}
                        className="text-xs font-bold text-blue-600 bg-blue-50 px-3 py-1 rounded-lg hover:bg-blue-100 transition-colors"
                      >
                        + Add Form
                      </button>
                    </div>

                    {multiItems.map((mItem, idx) => (
                      <div key={idx} className="bg-slate-50 border border-slate-100 p-4 rounded-2xl space-y-3 relative">
                        {multiItems.length > 1 && (
                          <button 
                            type="button"
                            onClick={() => {
                              const nm = [...multiItems];
                              nm.splice(idx, 1);
                              setMultiItems(nm);
                            }}
                            className="absolute -top-2 -right-2 bg-red-100 text-red-600 w-6 h-6 rounded-full flex items-center justify-center text-xs hover:bg-red-200"
                          >
                            ×
                          </button>
                        )}
                        <select
                          value={mItem.productName}
                          onChange={(e) => {
                            const nm = [...multiItems];
                            nm[idx].productName = e.target.value;
                            setMultiItems(nm);
                          }}
                          className="w-full bg-white border border-slate-200 px-4 py-3 rounded-xl focus:ring-2 focus:ring-blue-100 outline-none transition-all font-medium text-gray-700 text-sm"
                        >
                          {PRODUCTS.map(p => <option key={p.name} value={p.name}>{p.name}</option>)}
                        </select>
                        <div className="relative">
                          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 font-bold text-sm">Rp</span>
                          <input
                            type="text"
                            value={mItem.soldPrice ? new Intl.NumberFormat('id-ID').format(parseInt(mItem.soldPrice, 10)) : ''}
                            onChange={(e) => {
                              const val = e.target.value.replace(/\D/g, '');
                              const nm = [...multiItems];
                              nm[idx].soldPrice = val;
                              setMultiItems(nm);
                            }}
                            placeholder="Selling Price"
                            className="w-full bg-white border border-slate-200 pl-10 pr-4 py-3 rounded-xl focus:ring-2 focus:ring-blue-100 outline-none transition-all font-bold text-blue-600 text-sm"
                          />
                        </div>
                      </div>
                    ))}
                  </div>

                  <label className="flex items-center gap-2 px-2 py-2 cursor-pointer hover:bg-slate-50 rounded-lg transition-colors">
                    <input 
                      type="checkbox" 
                      checked={includeDuplicates} 
                      onChange={(e) => setIncludeDuplicates(e.target.checked)} 
                      className="w-4 h-4 text-blue-600 rounded"
                    />
                    <span className="text-sm font-bold text-slate-700">Force allow duplicates</span>
                  </label>

                  {status && (
                    <div className={cn(
                      "p-4 rounded-xl text-sm font-bold flex items-center gap-3 animate-in fade-in duration-300",
                      status.type === 'error' ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"
                    )}>
                      {status.type === 'error' ? <AlertCircle className="w-5 h-5"/> : <CheckCircle2 className="w-5 h-5"/>}
                      {status.msg}
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={saveLoading || multiTrackingNumber.trim() === '' || multiItems.every(i => !i.soldPrice)}
                    className="w-full bg-slate-900 text-white py-5 rounded-2xl font-bold uppercase tracking-[2px] hover:bg-black transition-all shadow-xl shadow-slate-200 disabled:opacity-30 disabled:shadow-none flex items-center justify-center gap-3"
                  >
                    {saveLoading ? <Loader2 className="w-5 h-5 animate-spin"/> : "Sync Multi-Item Bundle"}
                  </button>
                </form>
              ) : pendingBulkSales ? (
                <div className="space-y-4 animate-in fade-in zoom-in-95 duration-300">
                  <div className="flex items-center gap-2 mb-2 p-4 bg-yellow-50 text-yellow-900 rounded-xl">
                    <AlertCircle className="w-5 h-5 flex-shrink-0" />
                    <div>
                      <h3 className="font-bold">Review AI Extraction</h3>
                      <p className="text-sm opacity-80">
                        Found {pendingBulkSales.toBeAdded.length} new records and {pendingBulkSales.toBeSkipped.length} duplicates.
                      </p>
                    </div>
                  </div>

                  <div className="max-h-[300px] overflow-y-auto space-y-2 border border-slate-100 p-2 rounded-xl bg-slate-50">
                    <div className="text-xs uppercase font-bold text-slate-400 px-2 py-1 tracking-widest">New Records ({pendingBulkSales.toBeAdded.length})</div>
                    {pendingBulkSales.toBeAdded.length === 0 && (
                      <div className="text-sm text-slate-500 italic px-2">No new records found.</div>
                    )}
                    {pendingBulkSales.toBeAdded.map((item, i) => (
                      <div key={i} className="flex justify-between items-center text-sm bg-white p-3 rounded-lg border border-emerald-100 shadow-sm">
                        <div>
                          <p className="font-bold text-slate-800">{item.itemName}</p>
                          <p className="text-xs font-mono text-slate-500">{item.trackingNumber}</p>
                        </div>
                        <p className="font-bold text-emerald-600">New</p>
                      </div>
                    ))}

                    {pendingBulkSales.toBeSkipped.length > 0 && (
                      <div className="pt-2">
                        <label className="flex items-center gap-2 px-2 py-2 cursor-pointer hover:bg-slate-100 rounded-lg transition-colors">
                          <input 
                            type="checkbox" 
                            checked={includeDuplicates} 
                            onChange={(e) => setIncludeDuplicates(e.target.checked)} 
                            className="w-4 h-4 text-blue-600 rounded"
                          />
                          <span className="text-sm font-bold text-slate-700">Force add skipped duplicates</span>
                        </label>
                        
                        <div className="text-xs uppercase font-bold text-slate-400 px-2 pt-2 pb-1 tracking-widest">Skipped Duplicates ({pendingBulkSales.toBeSkipped.length})</div>
                        {pendingBulkSales.toBeSkipped.map((item, i) => (
                          <div key={`s-${i}`} className={cn("flex justify-between items-center text-sm p-3 rounded-lg mb-2", includeDuplicates ? "bg-white border border-yellow-200 shadow-sm" : "bg-slate-100 opacity-60")}>
                            <div>
                              <p className="font-bold">{item.itemName}</p>
                              <p className="text-xs font-mono">{item.trackingNumber}</p>
                            </div>
                            <p className={cn("font-bold", includeDuplicates ? "text-yellow-600" : "text-slate-500")}>Duplicate</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="flex gap-3 pt-2">
                    <button
                      type="button"
                      disabled={saveLoading}
                      onClick={() => setPendingBulkSales(null)}
                      className="flex-1 bg-slate-100 text-slate-600 py-4 rounded-xl font-bold uppercase tracking-[1px] hover:bg-slate-200 transition-all text-sm disabled:opacity-50"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      disabled={saveLoading || (pendingBulkSales.toBeAdded.length === 0 && (!includeDuplicates || pendingBulkSales.toBeSkipped.length === 0))}
                      onClick={confirmBulkSales}
                      className="flex-[2] bg-blue-600 text-white py-4 rounded-xl font-bold uppercase tracking-[1px] hover:bg-blue-700 transition-all shadow-xl shadow-blue-200 text-sm disabled:opacity-30 flex items-center justify-center gap-2"
                    >
                      {saveLoading ? <Loader2 className="w-5 h-5 animate-spin"/> : "Confirm & Save"}
                    </button>
                  </div>
                </div>
              ) : (
                <form onSubmit={handleListSubmit} className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-[11px] uppercase tracking-[2px] font-bold text-gray-400 ml-1">Paste List Data</label>
                    <textarea
                      value={listText}
                      onChange={(e) => setListText(e.target.value)}
                      placeholder="e.g.&#10;FAJ-360QB    CM23888920754&#10;FAJ-360BW    SPXID061789755984"
                      className="w-full bg-slate-50 border-none p-5 rounded-2xl focus:ring-2 focus:ring-blue-100 outline-none transition-all font-mono text-sm text-gray-700 h-64 resize-none"
                    />
                  </div>

                  {status && (
                    <div className={cn(
                      "p-4 rounded-xl text-sm font-bold flex items-center gap-3 animate-in fade-in duration-300",
                      status.type === 'error' ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"
                    )}>
                      {status.type === 'error' ? <AlertCircle className="w-5 h-5"/> : <CheckCircle2 className="w-5 h-5"/>}
                      {status.msg}
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={isAnalyzingList || !listText.trim()}
                    className="w-full bg-blue-600 text-white py-5 rounded-2xl font-bold uppercase tracking-[2px] hover:bg-blue-700 transition-all shadow-xl shadow-blue-200 disabled:opacity-30 disabled:shadow-none flex items-center justify-center gap-3"
                  >
                    {isAnalyzingList ? <Loader2 className="w-5 h-5 animate-spin"/> : "Process List via AI"}
                  </button>
                </form>
              )}
            </section>
          </div>

          {/* Table Area Right */}
          <div className="lg:col-span-8 space-y-8">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
              <div className="bg-white p-8 rounded-[32px] shadow-[0_20px_50px_rgba(0,0,0,0.03)] border border-gray-50 overflow-hidden relative group">
                <div className="absolute -right-4 -top-4 bg-emerald-50 w-24 h-24 rounded-full group-hover:scale-110 transition-transform duration-500 opacity-50" />
                <TrendingUp className="w-8 h-8 text-emerald-600 mb-4" />
                <h3 className="text-slate-400 text-xs font-bold uppercase tracking-widest mb-1">Total Profit</h3>
                <p className="text-3xl font-black text-slate-900">{formatCurrency(totalProfit)}</p>
              </div>
              <div className="bg-white p-8 rounded-[32px] shadow-[0_20px_50px_rgba(0,0,0,0.03)] border border-gray-50 overflow-hidden relative group">
                <div className="absolute -right-4 -top-4 bg-blue-50 w-24 h-24 rounded-full group-hover:scale-110 transition-transform duration-500 opacity-50" />
                <DollarSign className="w-8 h-8 text-blue-600 mb-4" />
                <h3 className="text-slate-400 text-xs font-bold uppercase tracking-widest mb-1">Total Revenue</h3>
                <p className="text-3xl font-black text-slate-900">{formatCurrency(totalRevenue)}</p>
              </div>
              <div className="bg-white p-8 rounded-[32px] shadow-[0_20px_50px_rgba(0,0,0,0.03)] border border-gray-50 overflow-hidden relative group">
                <div className="absolute -right-4 -top-4 bg-red-50 w-24 h-24 rounded-full group-hover:scale-110 transition-transform duration-500 opacity-50" />
                <LogOut className="w-8 h-8 text-red-600 mb-4" />
                <h3 className="text-slate-400 text-xs font-bold uppercase tracking-widest mb-1">Base Cost (To Pay)</h3>
                <p className="text-3xl font-black text-slate-900">{formatCurrency(totalToPay)}</p>
              </div>
            </div>

            <div className="bg-white rounded-[40px] shadow-[0_30px_60px_rgba(0,0,0,0.03)] border border-gray-50 overflow-hidden">
              <div className="p-10 border-b border-gray-50 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h2 className="text-2xl font-black tracking-tight mb-3">Ledger</h2>
                  <div className="flex bg-slate-100 p-1 rounded-xl w-fit">
                    <button onClick={() => setDashboardTab('ledger')} className={cn("px-4 py-2 text-[10px] uppercase tracking-wider font-bold rounded-lg transition-all", dashboardTab === 'ledger' ? "bg-white text-slate-800 shadow-sm" : "text-slate-500 hover:text-slate-700")}>Ledger</button>
                    <button onClick={() => setDashboardTab('paymentHistory')} className={cn("px-4 py-2 text-[10px] uppercase tracking-wider font-bold rounded-lg transition-all", dashboardTab === 'paymentHistory' ? "bg-white text-emerald-600 shadow-sm" : "text-slate-500 hover:text-slate-700")}>Payment History</button>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-4">
                  {dashboardTab === 'ledger' && ( 
                    <div className="flex bg-slate-100 p-1 rounded-xl">
                      <button onClick={() => setPaymentFilter('all')} className={cn("px-4 py-2 text-[10px] uppercase tracking-wider font-bold rounded-lg transition-all", paymentFilter === 'all' ? "bg-white text-slate-800 shadow-sm" : "text-slate-500 hover:text-slate-700")}>All</button>
                      <button onClick={() => setPaymentFilter('unpaid')} className={cn("px-4 py-2 text-[10px] uppercase tracking-wider font-bold rounded-lg transition-all", paymentFilter === 'unpaid' ? "bg-white text-amber-600 shadow-sm" : "text-slate-500 hover:text-slate-700")}>Unpaid</button>
                      <button onClick={() => setPaymentFilter('paid')} className={cn("px-4 py-2 text-[10px] uppercase tracking-wider font-bold rounded-lg transition-all", paymentFilter === 'paid' ? "bg-white text-emerald-600 shadow-sm" : "text-slate-500 hover:text-slate-700")}>Paid</button>
                    </div>
                  )}
                  {dashboardTab === 'ledger' && (
                    <button 
                      onClick={copyAllUnpaidOrders}
                      className="bg-slate-100 text-slate-700 font-bold rounded-2xl px-5 py-2.5 hover:bg-slate-200 transition flex items-center gap-2"
                    >
                      <Copy className="w-4 h-4" />
                      Copy all Unpaid
                    </button>
                  )}
                  <div className="relative group">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4 group-focus-within:text-blue-500 transition-colors" />
                    <input 
                      type="text" 
                      placeholder="Search SPX, Name, Date..." 
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="bg-slate-50 border border-slate-200 text-slate-700 text-sm font-bold rounded-2xl pl-10 pr-4 py-2.5 outline-none focus:ring-2 focus:ring-blue-100 placeholder:font-medium sm:w-64 w-full"
                    />
                  </div>
                  <select
                    value={timeFilter}
                    onChange={(e) => setTimeFilter(e.target.value as any)}
                    className="bg-slate-50 border border-slate-200 text-slate-700 text-sm font-bold rounded-2xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-blue-100"
                  >
                    <option value="today">Today</option>
                    <option value="week">This Week</option>
                    <option value="month">This Month</option>
                    <option value="all">All Time</option>
                  </select>
                  <button 
                    onClick={startPaymentFlow}
                    className="bg-blue-600 text-white text-sm font-bold rounded-2xl px-5 py-2.5 hover:bg-blue-700 transition flex items-center gap-2 shadow-lg shadow-blue-200"
                  >
                    <CreditCard className="w-4 h-4" />
                    I want to pay
                  </button>
                  <button 
                    onClick={() => {
                        setBatchEditMode(!batchEditMode);
                        setSelectedIds(new Set());
                        setBatchSoldPrice('');
                    }}
                    className={cn("text-sm font-bold rounded-2xl px-5 py-2.5 transition flex items-center gap-2", batchEditMode ? "bg-amber-100 text-amber-700 hover:bg-amber-200" : "bg-slate-100 text-slate-700 hover:bg-slate-200")}
                  >
                    Batch Edit
                  </button>
                </div>
              </div>

              <div className="overflow-x-auto">
                {batchEditMode && (
                  <div className="bg-amber-50 border-b border-amber-100 px-10 py-4 flex flex-wrap items-center gap-4">
                    <span className="text-sm font-bold text-amber-900">{selectedIds.size} selected</span>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-amber-700/50 font-bold text-sm">Rp</span>
                      <input 
                        type="text" 
                        placeholder="New Sold For" 
                        value={batchSoldPrice ? new Intl.NumberFormat('id-ID').format(parseInt(batchSoldPrice,10)) : ''}
                        onChange={e => setBatchSoldPrice(e.target.value.replace(/\D/g, ''))}
                        className="bg-white border-amber-200 border text-amber-900 text-sm font-bold rounded-xl pl-8 pr-4 py-2 outline-none focus:ring-2 focus:ring-amber-400 w-40"
                      />
                    </div>
                    <button 
                      onClick={applyBatchEdit} 
                      disabled={selectedIds.size === 0 || !batchSoldPrice || saveLoading} 
                      className="bg-amber-600 text-white px-4 py-2 rounded-xl font-bold text-sm hover:bg-amber-700 disabled:opacity-50 transition-colors flex items-center gap-2"
                    >
                      {saveLoading ? <Loader2 className="w-4 h-4 animate-spin"/> : "Apply to Selected"}
                    </button>
                  </div>
                )}
                <table className="w-full text-left">
                  <thead>
                    <tr className="bg-gray-50/50 text-gray-400 text-[10px] uppercase font-black tracking-[3px]">
                      {batchEditMode && (
                        <th className="px-6 py-6 w-10">
                          <input 
                            type="checkbox" 
                            className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500"
                            checked={selectedIds.size === filteredSales.length && filteredSales.length > 0}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedIds(new Set(filteredSales.map(s => s.id)));
                              } else {
                                setSelectedIds(new Set());
                              }
                            }}
                          />
                        </th>
                      )}
                      <th className="px-10 py-6">Product</th>
                      <th className="px-10 py-6">Date</th>
                      <th className="px-10 py-6">Sold For</th>
                      <th className="px-10 py-6">Base Cost</th>
                      <th className="px-10 py-6">Net Profit</th>
                      <th className="px-10 py-6">Tracking</th>
                      <th className="px-10 py-6 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {salesLoading ? (
                      <tr>
                        <td colSpan={batchEditMode ? 8 : 7} className="px-10 py-20 text-center">
                          <div className="flex flex-col items-center gap-4 text-blue-500">
                            <Loader2 className="w-8 h-8 animate-spin"/>
                            <p className="font-bold uppercase tracking-widest text-xs">Syncing with Ledger...</p>
                          </div>
                        </td>
                      </tr>
                    ) : filteredSales.map((sale) => (
                      <tr key={sale.id} className={cn("group transition-colors", sale.isYellow ? "bg-yellow-50" : "", sale.isPaid ? "opacity-60 bg-gray-50/50" : "hover:bg-slate-50/30", selectedIds.has(sale.id) && "bg-amber-50/30")}>
                        {batchEditMode && (
                          <td className="px-6 py-7">
                            <input 
                              type="checkbox" 
                              className="w-4 h-4 rounded text-amber-600 focus:ring-amber-500"
                              checked={selectedIds.has(sale.id)}
                              onChange={(e) => {
                                const newSet = new Set(selectedIds);
                                if (e.target.checked) newSet.add(sale.id);
                                else newSet.delete(sale.id);
                                setSelectedIds(newSet);
                              }}
                            />
                          </td>
                        )}
                        <td className={cn("px-10 py-7 font-bold text-slate-800", sale.isPaid && "line-through text-slate-400")}>{sale.itemName}</td>
                        <td className={cn("px-10 py-7 font-medium text-slate-500 whitespace-nowrap", sale.isPaid && "line-through text-slate-400")}>
                          {new Date(sale.createdAt?.toMillis?.() || Date.now()).toLocaleDateString('en-GB')}
                        </td>
                        <td className={cn("px-10 py-7 font-medium text-blue-600", sale.isPaid && "line-through text-slate-400")}>{formatCurrency(sale.soldPrice)}</td>
                        <td className={cn("px-10 py-7 font-medium text-rose-500", sale.isPaid && "line-through text-slate-400")}>{formatCurrency(sale.originalPrice)}</td>
                        <td className={cn("px-10 py-7", sale.isPaid && "line-through")}>
                          <span className={cn(
                            "font-black text-lg",
                            sale.isPaid ? "text-slate-400" : (sale.profit >= 0 ? "text-emerald-500" : "text-rose-500")
                          )}>
                            {sale.profit >= 0 ? '+' : ''}{formatCurrency(sale.profit)}
                          </span>
                        </td>
                        <td className={cn("px-10 py-7 font-mono text-xs text-slate-400 uppercase tracking-tighter", sale.isPaid && "line-through")}>
                          {sale.trackingNumber || '-'}
                        </td>
                        <td className="px-10 py-7 text-right">
                          <div className="flex items-center justify-end gap-2">
                             <button
                               onClick={() => toggleYellowStatus(sale.id, sale.isYellow)}
                               className={cn("p-2 rounded-xl transition-all", sale.isYellow ? "bg-yellow-200" : "bg-gray-100 hover:bg-yellow-100")}
                             >
                               <Star className={cn("w-4 h-4", sale.isYellow ? "text-yellow-600" : "text-gray-400")} />
                             </button>
                            {dashboardTab === 'paymentHistory' ? (
                                <button
                                  onClick={() => copySinglePayment(sale)}
                                  className="bg-emerald-50 text-emerald-600 p-2 rounded-xl transition-all hover:bg-emerald-100 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider"
                                >
                                  <Copy className="w-4 h-4"/>
                                  Copy
                                </button>
                            ) : (
                                <button 
                                  onClick={() => togglePaidStatus(sale.id, sale.isPaid)}
                                  disabled={actionLoading === sale.id}
                                  className={cn(
                                    "p-2 rounded-xl transition-all disabled:opacity-50 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider",
                                    sale.isPaid 
                                      ? "bg-slate-200 text-slate-500 hover:bg-slate-300"
                                      : "bg-emerald-50 text-emerald-600 hover:bg-emerald-100"
                                  )}
                                >
                                  {actionLoading === sale.id ? <Loader2 className="w-4 h-4 animate-spin" /> : (sale.isPaid ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />)}
                                  {sale.isPaid ? "Paid" : "Mark Paid"}
                                </button>
                            )}
                            <button 
                              onClick={() => deleteSale(sale.id)}
                              disabled={deleteLoading === sale.id}
                              className="p-2 text-slate-300 hover:text-rose-500 hover:bg-rose-50 rounded-xl transition-all disabled:opacity-50"
                            >
                              {deleteLoading === sale.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {!salesLoading && filteredSales.length === 0 && (
                      <tr>
                        <td colSpan={batchEditMode ? 8 : 7} className="px-10 py-20 text-center">
                          <div className="flex flex-col items-center gap-4 text-slate-300">
                            <Package className="w-12 h-12 opacity-50"/>
                            <p className="font-bold uppercase tracking-widest text-xs">No records found for this period</p>
                          </div>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

        </div>
      </main>
      
      <footer className="py-12 px-4 sm:px-6 lg:px-8 border-t border-gray-50 text-center">
        <p className="text-[10px] uppercase font-black tracking-[3px] text-gray-400">Ledger v4.2 &bull; Secure Auth Active</p>
      </footer>

      {/* Payment Flow Modal */}
      {payModalState !== 'closed' && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
          <div className="bg-white rounded-[32px] shadow-2xl p-8 max-w-lg w-full max-h-[90vh] overflow-y-auto relative animate-in fade-in zoom-in-95 duration-200">
            <button 
              onClick={() => setPayModalState('closed')}
              className="absolute top-6 right-6 p-2 text-slate-400 hover:text-slate-600 bg-slate-50 hover:bg-slate-100 rounded-full transition-colors"
            >
              <X className="w-5 h-5"/>
            </button>

            {payModalState === 'input' && (
              <div className="space-y-6 pt-2">
                <div className="space-y-2">
                  <h2 className="text-2xl font-black">Generate Payment List</h2>
                  <p className="text-slate-500">How many unpaid products do you want to pay for right now?</p>
                </div>
                <input 
                  type="number" 
                  autoFocus
                  placeholder="e.g. 2"
                  value={payCount}
                  onChange={(e) => setPayCount(e.target.value)}
                  className="w-full text-center text-4xl font-black py-6 bg-slate-50 rounded-2xl border-none focus:ring-4 focus:ring-blue-100 outline-none transition-all"
                />
                <button 
                  onClick={generatePaymentList}
                  disabled={!parseInt(payCount, 10)}
                  className="w-full bg-blue-600 text-white font-bold py-4 rounded-2xl disabled:opacity-50 hover:bg-blue-700 transition-colors"
                >
                  Get Random Unpaid Items
                </button>
              </div>
            )}

            {payModalState === 'confirm' && (
              <div className="space-y-6 pt-2">
                <div className="space-y-2">
                  <h2 className="text-2xl font-black">Payment Confirmation</h2>
                  <p className="text-slate-500">Here are {selectedToPay.length} selected random unpaid items.</p>
                </div>

                <div className="bg-slate-50 p-4 rounded-2xl space-y-3 font-mono text-sm max-h-60 overflow-y-auto border border-slate-100">
                  {selectedToPay.map((item) => (
                    <div key={item.id} className="p-3 bg-white rounded-xl shadow-sm border border-slate-100 flex flex-col gap-1">
                      <span className="font-bold text-slate-800">{item.itemName}</span>
                      <div className="flex justify-between text-[11px] text-slate-500 tracking-tight">
                        <span className="text-blue-600 font-bold">{item.trackingNumber || 'No Code'}</span>
                        <span className="font-bold text-rose-500">{formatCurrency(item.originalPrice)}</span>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="flex items-center justify-between p-4 bg-red-50 rounded-2xl border border-red-100">
                  <span className="text-sm font-bold text-red-600 uppercase tracking-widest">Total to Pay</span>
                  <span className="text-2xl font-black text-red-700">
                    {formatCurrency(selectedToPay.reduce((sum, item) => sum + item.originalPrice, 0))}
                  </span>
                </div>

                <div className="flex flex-col gap-3">
                  <button 
                    onClick={copyPaymentList}
                    className="w-full bg-slate-100 text-slate-700 font-bold py-4 rounded-2xl hover:bg-slate-200 transition-colors flex items-center justify-center gap-2"
                  >
                    <Copy className="w-5 h-5"/>
                    Copy All (Line by Line)
                  </button>
                  <div className="flex gap-3">
                    <button 
                      onClick={() => setPayModalState('closed')}
                      className="flex-1 bg-red-50 text-red-600 font-bold py-4 rounded-2xl hover:bg-red-100 transition-colors"
                    >
                      I didn't pay
                    </button>
                    <button 
                      onClick={confirmPayment}
                      disabled={payProcessing}
                      className="flex-1 bg-emerald-500 text-white font-bold py-4 rounded-2xl disabled:opacity-50 hover:bg-emerald-600 transition-colors flex items-center justify-center gap-2"
                    >
                      {payProcessing ? <Loader2 className="w-5 h-5 animate-spin" /> : "I Paid!"}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
