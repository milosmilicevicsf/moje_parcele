// Road navigation happens in other apps. On Android a geo: link lets the user pick any installed map app,
// including ones with offline routing such as OsmAnd or Organic Maps; iOS does not handle geo: links.
export function navigationLinks([lon,lat],label){
  const dest=lat.toFixed(6)+','+lon.toFixed(6);
  return {
    google:'https://www.google.com/maps/dir/?api=1&destination='+encodeURIComponent(dest)+'&travelmode=driving',
    apple:'https://maps.apple.com/?daddr='+encodeURIComponent(dest)+'&dirflg=d',
    waze:'https://waze.com/ul?ll='+encodeURIComponent(dest)+'&navigate=yes',
    geo:'geo:'+dest+'?q='+dest+'('+encodeURIComponent(label)+')'
  };
}
