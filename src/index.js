import Panorama3D from "./Panorama3D"
let uniqueID = '000';
const pathname = window.location.pathname.replaceAll('/', '');
if (pathname.length) {
  uniqueID = pathname;
}
const panorama = new Panorama3D('app', 'http://localhost:1234', uniqueID);
panorama.run();