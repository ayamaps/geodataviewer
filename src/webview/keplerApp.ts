declare const React: any;
declare const ReactDOM: any;
declare const ReactRedux: any;

export function renderKeplerApp(
  container: HTMLElement,
  store: any,
  KeplerGlComponent: any,
  mapboxToken: string,
) {
  function App() {
    const [size, setSize] = React.useState({
      width: window.innerWidth,
      height: window.innerHeight,
    });

    React.useEffect(() => {
      function onResize() {
        setSize({
          width: window.innerWidth,
          height: window.innerHeight,
        });
      }

      window.addEventListener("resize", onResize);
      return () => window.removeEventListener("resize", onResize);
    }, []);

    return React.createElement(
      "div",
      {
        style: {
          position: "absolute",
          left: 0,
          width: "100vw",
          height: "100vh",
        },
      },
      React.createElement(KeplerGlComponent, {
        id: "kepler-map",
        width: size.width,
        height: size.height,
        mapboxApiAccessToken: mapboxToken,
      }),
    );
  }

  const app = React.createElement(
    ReactRedux.Provider,
    { store },
    React.createElement(App),
  );

  if (typeof ReactDOM.createRoot === "function") {
    const root = ReactDOM.createRoot(container);
    root.render(app);
    return root;
  }

  ReactDOM.render(app, container);
  return null;
}
