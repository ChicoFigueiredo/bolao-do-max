# Bolão do Max

https://bolao.maxmat1.com.br

## Para lembrar

* Instalar o Apache
* Instala o arquivo 001-01-bolao.maxmat1.com.br.conf comentando o bloco _IfModule mod_ssl.c_
* Aplica a certificação Digital
* Remove os comentários de 001-01-bolao.maxmat1.com.br.conf
* Instalar o Docker
* Clona o git (lembre-se de suas credenciais ssh)
* Verificar as portas no docker-compose.yaml batem com 001-01-bolao.maxmat1.com.br.conf
* Vai a pasta raiz do projeto clonado e faz build/up com docker compose

## Algumas instruções para lembrar

### Apache

```bash
a2ensite 001-01-bolao.maxmat1.com.br.conf
systemctl restart apache2

certbot --apache certonly -d bolao.maxmat1.com.br
```

### Clone do git

```bash
git clone git@gitlab.com:maxmat1/bolao.maxmat1.com.br.git
```


### Build and up do Docker Compose

```bash
docker-compose up --build -d
```


### 001-01-bolao.maxmat1.com.br.conf :
```conf

<VirtualHost *:80>

     ServerName bolao.maxmat1.com.br
     ServerAlias bolao.maxmat1.com.br

     ServerAdmin webmaster@localhost

    ProxyPreserveHost On

    ProxyPass / http://localhost:5001/
    ProxyPassReverse / http://localhost:5001/

    logLevel error
    ErrorLog /var/log/apache2/bolao.maxmat1.com.br.log

	RewriteEngine on
	RewriteCond %{SERVER_NAME} =bolao.maxmat1.com.br
	RewriteRule ^ https://%{SERVER_NAME}%{REQUEST_URI} [END,NE,R=permanent]
</VirtualHost>

<IfModule mod_ssl.c>
	<VirtualHost *:443>

		ServerName bolao.maxmat1.com.br
		ServerAlias bolao.maxmat1.com.brl

		ServerAdmin webmaster@localhost

		ProxyPreserveHost On
		
		ProxyPass / http://localhost:5001/
		ProxyPassReverse / http://localhost:5001/

		PassEnv HOSTNAME
		Header set X-Hostname "%{HOSTNAME}e"
		Header set X-Which-Host-Am-I "%{HOSTNAME}e"

		logLevel error
		ErrorLog /var/log/apache2/bolao.maxmat1.com.br-ssl.log

		Include /etc/letsencrypt/options-ssl-apache.conf

		SSLCertificateFile /etc/letsencrypt/live/bolao.maxmat1.com.br/fullchain.pem
		SSLCertificateKeyFile /etc/letsencrypt/live/bolao.maxmat1.com.br/privkey.pem
	</VirtualHost>	
</IfModule>

```

