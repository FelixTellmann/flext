// eslint-disable-next-line @next/next/no-document-import-in-page
import { Favicon } from "_client/_document/favicon";
import { Font } from "_client/_document/font";
import Document, { Head, Html, Main, NextScript } from "next/document";
import Script from "next/script";

class Root extends Document {
  render(): JSX.Element {
    // language=JavaScript
    return (
      <Html lang="en">
        <Head>
          <Favicon />
          <Font />

          {/*{process.env.NODE_ENV === "production"
            ? */}
          <Script
            id="umami-script"
            async
            defer
            dangerouslySetInnerHTML={{
              __html: `!function(){"use strict";var t=function(t,e,n){var r=t[e];return function(){for(var e=[],i=arguments.length;i--;)e[i]=arguments[i];return n.apply(null,e),r.apply(t,e)}},e=function(){var t=window.doNotTrack,e=window.navigator,n=window.external,r="msTrackingProtectionEnabled",i=t||e.doNotTrack||e.msDoNotTrack||n&&r in n&&n[r]();return"1"==i||"yes"===i};!function(n){var r=n.screen,i=r.width,a=r.height,o=n.navigator.language,c=n.location,u=n.localStorage,s=n.document,l=n.history,f=c.hostname,d=c.pathname,v=c.search,h=s.currentScript;if(h){var p,m,g="data-",b="false",w=h.getAttribute.bind(h),y=w(g+"website-id"),S=w(g+"host-url"),k=w(g+"auto-track")!==b,E=w(g+"do-not-track"),T=w(g+"css-events")!==b,A=w(g+"domains")||"",N=A.split(",").map((function(t){return t.trim()})),j=/^umami--([a-z]+)--([\\w]+[\\w-]*)$/,x="[class*='umami--']",O=function(){return u&&u.getItem("umami.disabled")||E&&e()||A&&!N.includes(f)},K=(S?(p=S)&&p.length>1&&p.endsWith("/")?p.slice(0,-1):p:h.src.split("/").slice(0,-1).join("/"))+"/api/telemetry",L=i+"x"+a,D={},P=""+d+v,_=s.referrer,q=function(){return{website:y,hostname:f,screen:L,language:o,url:P}},z=function(t,e){return Object.keys(e).forEach((function(n){void 0!==e[n]&&(t[n]=e[n])})),t},C=function(t,e){var n;if(!O())return fetch(K,{method:"POST",body:JSON.stringify({type:t,payload:e}),headers:z({"Content-Type":"application/json"},(n={},n["x-umami-cache"]=m,n))}).then((function(t){return t.text()})).then((function(t){return m=t}))},I=function(t,e,n){return void 0===t&&(t=P),void 0===e&&(e=_),void 0===n&&(n=y),C("pageview",z(q(),{website:n,url:t,referrer:e}))},J=function(t,e,n,r){return void 0===n&&(n=P),void 0===r&&(r=y),C("event",z(q(),{website:r,url:n,event_name:t,event_data:e}))},M=function(t){var e=t.querySelectorAll(x);Array.prototype.forEach.call(e,V)},V=function(t){var e=t.getAttribute.bind(t);(e("class")||"").split(" ").forEach((function(n){if(j.test(n)){var r=n.split("--"),i=r[1],a=r[2],o=D[n]?D[n]:D[n]=function(n){"click"!==i||"A"!==t.tagName||n.ctrlKey||n.shiftKey||n.metaKey||n.button&&1===n.button||e("target")?J(a):(n.preventDefault(),J(a).then((function(){c.href=e("href")})))};t.addEventListener(i,o,!0)}}))},W=function(t,e,n){if(n){_=P;var r=n.toString();(P="http"===r.substring(0,4)?"/"+r.split("/").splice(3).join("/"):r)!==_&&I()}};if(!n.umami){var $=function(t){return J(t)};$.trackView=I,$.trackEvent=J,n.umami=$}if(k&&!O()){l.pushState=t(l,"pushState",W),l.replaceState=t(l,"replaceState",W);var B=function(){"complete"===s.readyState&&(I(),T&&(M(s),new MutationObserver((function(t){t.forEach((function(t){var e=t.target;V(e),M(e)}))})).observe(s,{childList:!0,subtree:!0})))};s.addEventListener("readystatechange",B,!0),B()}}}(window)}();`,
            }}
            strategy="lazyOnload"
            data-website-id="69aaf2ad-a456-4a0e-9d99-b31687decc50"
          />
          {/*: null}*/}
        </Head>
        <body className="color-gray--slate bg-white [--line-color:theme(colors.gray.200/0.8)] d:bg-gray-900 d:bg-gradient-to-b d:from-black/40 d:to-black/40">
          <Main />
          <NextScript />
        </body>
      </Html>
    );
  }
}

export default Root;
