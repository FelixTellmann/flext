import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping(value = "/welcome")
public class Welcome {
    
    @GetMapping
    public String sayHello() {
        return "Hello, it's Mateus Neres website!";
    }
}