export function slideAfterSwipe(index,count,start,end){if(count<2||!Number.isFinite(start)||!Number.isFinite(end)||Math.abs(end-start)<=40)return index;return (index+(end>start?1:count-1))%count;}
