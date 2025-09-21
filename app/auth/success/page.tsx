// app/auth/success/page.tsx

export default function AuthSuccess() {
  return (
    <div style={{ 
      display: 'flex', 
      flexDirection: 'column', 
      alignItems: 'center', 
      justifyContent: 'center', 
      height: '100vh',
      fontFamily: 'Arial, sans-serif',
      backgroundColor: '#f5f5f5'
    }}>
      <div style={{
        backgroundColor: 'white',
        padding: '2rem',
        borderRadius: '8px',
        boxShadow: '0 2px 10px rgba(0,0,0,0.1)',
        textAlign: 'center',
        maxWidth: '500px'
      }}>
        <h1 style={{ color: '#fc4c02' }}>✅ Autorisation Strava réussie !</h1>
        <p style={{ color: '#333', marginBottom: '1rem' }}>
          Ton application peut maintenant accéder à tes activités Strava.
        </p>
        <p style={{ color: '#666' }}>
          Tu peux fermer cette page et tester en uploadant une nouvelle activité sur Strava.
        </p>
        <div style={{ 
          marginTop: '1.5rem', 
          padding: '1rem', 
          backgroundColor: '#f0f8ff', 
          borderRadius: '4px',
          fontSize: '0.9rem'
        }}>
          <strong>Next :</strong> Upload une activité sur Strava pour tester le webhook !
        </div>
      </div>
    </div>
  );
}
