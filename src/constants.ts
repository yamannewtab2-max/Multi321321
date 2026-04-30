export const PRODUCTS = [
  { name: 'FAJ-106', originalPrice: 157000 },
  { name: 'FAJ-113', originalPrice: 297000 },
  { name: 'FAJ-360', originalPrice: 390000 },
  { name: 'WR-02 SW', originalPrice: 207000 },
  { name: 'WR-02 TTGW', originalPrice: 236000 },
  { name: 'WR-02  FG', originalPrice: 236000 },
  { name: 'WS-06 SW', originalPrice: 214000 },
  { name: 'WS-06 TTGW', originalPrice: 243000 },
  { name: 'WS-06  FG', originalPrice: 243000 },
  { name: 'WF-14  FG', originalPrice: 236000 },
  { name: 'WF-14 GBL', originalPrice: 222000 },
  { name: 'WF-14  GB', originalPrice: 236000 },
  { name: 'WF-14  SW', originalPrice: 207000 },
  { name: 'WF-14 FG/D', originalPrice: 243000 },
  { name: 'WF-14 GB/D', originalPrice: 243000 },
  { name: 'AS-S016 BB', originalPrice: 168000 },
  { name: 'AS-S016 GB', originalPrice: 168000 },
];

export const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
};
